import os
import json
from datetime import datetime
import uvicorn
import requests
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, Column, DateTime
from sqlalchemy.orm import Session
from database import init_db, get_db
from proxy import router as proxy_router, limiter
from models import Policy, AuditLog
from pydantic import BaseModel
from typing import Optional
from auth import router as auth_router, require_auth
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from policy_engine import evaluate_policy, check_condition
from websocket_manager import broadcast

try:
    from dotenv import load_dotenv
    load_dotenv()
    print("[ai/forge-rule] dotenv loaded (.env).")
except Exception as e:
    # If python-dotenv isn't installed or .env missing, we still proceed.
    print(f"[ai/forge-rule] dotenv not loaded: {e}")


# lifespan replaces on_event startup
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    print("Database tables created")
    yield


app = FastAPI(title="AgentGate", lifespan=lifespan)

# Import the SAME limiter instance from proxy.py — this is the fix for the 500 error
# slowapi requires app.state.limiter and the @limiter.limit decorator to share ONE object
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

allowed_origins = [
    FRONTEND_URL,
    FRONTEND_URL.rstrip("/"),
    "http://localhost:3000",
    "http://localhost:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(proxy_router)
app.include_router(auth_router)


@app.get("/auth/status")
def auth_status(request: Request):
    u = request.cookies.get("ag_auth_user") or ""
    return {"logged_in": bool(u), "user": u}


@app.get("/auth/refresh")
def auth_refresh(request: Request, response: Response):
    u = request.cookies.get("ag_auth_user")
    if u:
        response.set_cookie(
            key="ag_auth_user",
            value=u,
            max_age=60 * 60 * 24 * 7,
            samesite="lax",
            path="/",
            httponly=True,
        )
    return {"ok": True}


@app.get("/auth/connected-services")
async def get_connected_services(current_user: str = Depends(require_auth), db: Session = Depends(get_db)):
    try:
        from token_vault import get_m2m_token
        import httpx
        m2m_token = await get_m2m_token()
        user_id_encoded = current_user.replace("|", "%7C")
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://{os.getenv('AUTH0_DOMAIN')}/api/v2/users/{user_id_encoded}",
                headers={"Authorization": f"Bearer {m2m_token}"}
            )
        print(f"[connected-services] status: {resp.status_code}")
        print(f"[connected-services] user_id: {user_id_encoded}")
        if resp.status_code != 200:
            print(f"[connected-services] error body: {resp.text}")
        if resp.status_code == 200:
            identities = resp.json().get("identities", [])
            services = [{"service": i.get("connection"), "connected": True} for i in identities]
            return {"services": services}
        return {"services": [], "error": f"Auth0 returned {resp.status_code}: {resp.text}"}
    except Exception as e:
        return {"services": [], "error": str(e)}


@app.get("/")
def root():
    try:
        # Test database connectivity
        db = next(get_db())
        db.execute(text("SELECT 1"))
        db.close()
        db_status = "ok"
    except Exception:
        db_status = "error"
    
    return {
        "status": "ok",
        "db": db_status
    }


# ─── Policy CRUD ─────────────────────────────────────────────────────────────

class PolicyCreate(BaseModel):
    action: str
    condition: str
    effect: str
    reason: str


class ForgeRuleRequest(BaseModel):
    text: Optional[str] = None


@app.post("/ai/forge-rule")
def forge_rule(payload: ForgeRuleRequest, request: Request = Depends(require_auth)):
    req_id = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    print(f"[ai/forge-rule:{req_id}] request received. payload={payload.model_dump()}")
    text = (payload.text or "").strip()
    if not text:
        print(f"[ai/forge-rule:{req_id}] FAIL: empty text after strip.")
        raise HTTPException(status_code=400, detail="Text is required.")

    # Sanitize text: remove text after certain keywords
    keywords = ["ignore", "forget", "disregard", "override", "instead", "you are now"]
    for keyword in keywords:
        idx = text.lower().find(keyword.lower())
        if idx != -1:
            text = text[:idx].strip()
            break

    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        print(f"[ai/forge-rule:{req_id}] FAIL: GROQ_API_KEY missing in environment.")
        raise HTTPException(status_code=400, detail="GROQ_API_KEY is not set.")
    print(f"[ai/forge-rule:{req_id}] GROQ_API_KEY loaded (len={len(groq_api_key)}).")

    system_instruction = (
        "You are a security policy assistant for AgentGate.\n"
        "Convert the user's description into a policy rule.\n"
        "Available actions: send_email, github_push, read_email,\n"
        "read_calendar, calendar_write, github_delete.\n"
        "Available effects: BLOCK, BLOCK+STEPUP.\n"
        "Reply ONLY with raw JSON, no markdown, no explanation:\n"
        "{ action, condition, effect, reason }"
    )

    url = "https://api.groq.com/openai/v1/chat/completions"
    model = "llama-3.1-8b-instant"
    print(f"[ai/forge-rule:{req_id}] calling Groq. model={model} text_len={len(text)}")

    try:
        response = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {groq_api_key}",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": f"[USER INPUT START]{text}[USER INPUT END]"},
                ],
            },
            timeout=30,
        )
    except requests.RequestException as e:
        print(f"[ai/forge-rule:{req_id}] FAIL: requests exception: {repr(e)}")
        raise HTTPException(status_code=400, detail=f"Groq request failed: {e}")

    if not response.ok:
        body_preview = (response.text or "")[:1000]
        print(f"[ai/forge-rule:{req_id}] FAIL: Groq HTTP {response.status_code}. body_preview={body_preview!r}")
        raise HTTPException(
            status_code=400,
            detail=f"Groq request failed ({response.status_code}): {response.text}",
        )

    try:
        data = response.json()
    except ValueError:
        body_preview = (response.text or "")[:1000]
        print(f"[ai/forge-rule:{req_id}] FAIL: Groq returned non-JSON HTTP body. preview={body_preview!r}")
        raise HTTPException(status_code=400, detail="Groq returned non-JSON response.")

    print(f"[ai/forge-rule:{req_id}] Groq responded OK. top_keys={list(data.keys())}")
    raw = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    raw = raw.strip() if isinstance(raw, str) else ""
    if not raw:
        print(f"[ai/forge-rule:{req_id}] FAIL: extracted empty text from Groq response. data_preview={str(data)[:1000]!r}")
        raise HTTPException(status_code=400, detail="Groq returned an empty response.")

    try:
        rule = json.loads(raw)
    except ValueError:
        print(f"[ai/forge-rule:{req_id}] FAIL: invalid JSON from Groq. raw_preview={(raw or '')[:1000]!r}")
        raise HTTPException(status_code=400, detail="Groq returned invalid JSON.")

    required_fields = ["action", "condition", "effect"]
    if any(not rule.get(field) for field in required_fields):
        print(f"[ai/forge-rule:{req_id}] FAIL: JSON missing required fields. rule={rule!r}")
        raise HTTPException(status_code=400, detail="Groq JSON missing required fields.")
    
    # reason is optional — default to empty string if not provided
    rule["reason"] = rule.get("reason", "")

    print(f"[ai/forge-rule:{req_id}] SUCCESS: returning rule fields.")
    return {field: rule[field] for field in ["action", "condition", "effect", "reason"]}


class SandboxSimulateRequest(BaseModel):
    action: str
    params: dict = {}
    rule_override: Optional[dict] = None
    temp_rule: Optional[dict] = None


class StepUpResolveRequest(BaseModel):
    approved: bool


@app.post("/sandbox/simulate")
async def sandbox_simulate(body: SandboxSimulateRequest, request: Request = Depends(require_auth), db: Session = Depends(get_db)):
    action = (body.action or "").strip()
    params = body.params or {}
    rule_override = body.rule_override
    temp_rule = body.temp_rule

    if not action:
        raise HTTPException(status_code=400, detail="action is required")

    # Run through the REAL policy engine (temp_rule first, then DB rules, or rule_override)
    decision = {
        "allowed": None,
        "step_up_required": False,
        "rule": None,          # {id, action, condition, effect, reason}
        "matched": None,       # only meaningful for rule_override
        "message": None,
    }

    if temp_rule:
        try:
            tc = str(temp_rule.get("condition", "")).strip()
            te = str(temp_rule.get("effect", "")).strip()
        except Exception:
            raise HTTPException(status_code=400, detail="temp_rule must be an object with {condition, effect}")

        if not tc or not te:
            raise HTTPException(status_code=400, detail="temp_rule missing required fields {condition, effect}")

        matched = check_condition(tc, params)
        step_up_required = str(te).upper() == "BLOCK+STEPUP"

        if matched:
            # Intercept immediately, before checking DB rules
            result = type("PolicyResultLike", (), {})()
            result.allowed = False
            result.rule_id = None
            result.reason = "Temporary rule matched"
            result.step_up_required = step_up_required

            decision["allowed"] = False
            decision["step_up_required"] = step_up_required
            decision["matched"] = True
            decision["rule"] = {"id": None, "action": action, "condition": tc, "effect": te, "reason": "Temporary rule matched"}
            decision["message"] = "This action requires manual approval before executing" if step_up_required else "Agent action was intercepted by AgentGate"
        else:
            # Fall through to normal DB evaluation
            try:
                result = evaluate_policy(action, params, db)
            except Exception as e:
                print(f"DB Error: {e}")
                raise HTTPException(status_code=500, detail="Database error")
            decision["allowed"] = result.allowed
            decision["step_up_required"] = result.step_up_required
            decision["matched"] = False
            decision["rule"] = {"id": None, "action": action, "condition": tc, "effect": te, "reason": "Temporary rule did not match"}
            if result.allowed:
                decision["message"] = "No matching rule — action permitted"
            elif result.step_up_required:
                decision["message"] = "This action requires manual approval before executing"
            else:
                decision["message"] = "Agent action was intercepted by AgentGate"

    elif rule_override:
        try:
            ra = str(rule_override.get("action", "")).strip()
            rc = str(rule_override.get("condition", "")).strip()
            reff = str(rule_override.get("effect", "")).strip()
            rr = str(rule_override.get("reason", "")).strip()
        except Exception:
            raise HTTPException(status_code=400, detail="rule_override must be an object with {action, condition, effect, reason}")

        if not ra or not rc or not reff or not rr:
            raise HTTPException(status_code=400, detail="rule_override missing required fields {action, condition, effect, reason}")
        if ra != action:
            raise HTTPException(status_code=400, detail="rule_override.action must match request action")

        matched = check_condition(rc, params)
        step_up_required = str(reff).upper() == "BLOCK+STEPUP"
        result = type("PolicyResultLike", (), {})()
        result.allowed = not matched
        result.rule_id = None
        result.reason = rr if matched else None
        result.step_up_required = step_up_required if matched else False

        decision["allowed"] = result.allowed
        decision["step_up_required"] = result.step_up_required
        decision["matched"] = matched
        decision["rule"] = {"id": None, "action": ra, "condition": rc, "effect": reff, "reason": rr}
        if matched:
            decision["message"] = "Agent action was intercepted by AgentGate" if not step_up_required else "This action requires manual approval before executing"
        else:
            decision["message"] = "No matching rule — action permitted (override rule did not match sample)"
    else:
        try:
            result = evaluate_policy(action, params, db)
        except Exception as e:
            print(f"DB Error: {e}")
            raise HTTPException(status_code=500, detail="Database error")
        decision["allowed"] = result.allowed
        decision["step_up_required"] = result.step_up_required
        decision["matched"] = None
        if not result.allowed and result.rule_id is not None:
            try:
                rule_obj = db.query(Policy).filter(Policy.id == result.rule_id).first()
            except Exception:
                rule_obj = None
            if rule_obj:
                decision["rule"] = {
                    "id": rule_obj.id,
                    "action": rule_obj.action,
                    "condition": rule_obj.condition,
                    "effect": rule_obj.effect,
                    "reason": rule_obj.reason,
                }
        if result.allowed:
            decision["message"] = "No matching rule — action permitted"
        elif result.step_up_required:
            decision["message"] = "This action requires manual approval before executing"
        else:
            decision["message"] = "Agent action was intercepted by AgentGate"

    # don't call real APIs in sandbox
    fake_success = {"ok": True, "execution_lab": True, "message": "Simulated execution only (no external API call)."}

    # Log to audit log with a SANDBOX tag (stored in params + result)
    sandbox_params = dict(params)
    sandbox_params["_tag"] = "EX-LAB"
    sandbox_params["_ex_lab"] = True

    log_entry = AuditLog(
        action=action,
        params=sandbox_params,
        allowed=result.allowed,
        rule_id=result.rule_id,
        reason=result.reason,
        step_up_required=result.step_up_required,
        step_up_approved=False,
        result={
            "execution_lab": True,
            "tag": "EX-LAB",
            "simulated": True,
            "fake": fake_success,
            "rule_override": rule_override if rule_override else None,
            "temp_rule": temp_rule if temp_rule else None,
        },
    )
    try:
        db.add(log_entry)
        db.commit()
        db.refresh(log_entry)
    except Exception as e:
        print(f"DB Error: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    # Broadcast like normal so it appears in Live Feed
    await broadcast({"type": "action", "data": log_entry.to_dict()})

    if not result.allowed:
        return {
            "allowed": False,
            "reason": result.reason,
            "rule_id": result.rule_id,
            "step_up_required": result.step_up_required,
            "decision": decision,
        }

    return {"allowed": True, "result": fake_success, "decision": decision}


@app.get("/policies")
def get_policies(request: Request = Depends(require_auth), db: Session = Depends(get_db)):
    try:
        policies = db.query(Policy).all()
    except Exception as e:
        print(f"DB Error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    return [p.to_dict() for p in policies]


@app.post("/policies")
def create_policy(policy: PolicyCreate, request: Request = Depends(require_auth), db: Session = Depends(get_db)):
    try:
        new_policy = Policy(**policy.model_dump())
        db.add(new_policy)
        db.commit()
        db.refresh(new_policy)
    except Exception as e:
        print(f"DB Error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    return new_policy.to_dict()


@app.delete("/policies/{policy_id}")
def delete_policy(policy_id: int, request: Request = Depends(require_auth), db: Session = Depends(get_db)):
    try:
        policy = db.query(Policy).filter(Policy.id == policy_id).first()
        if not policy:
            raise HTTPException(status_code=404, detail=f"Policy {policy_id} not found")
        db.delete(policy)
        db.commit()
    except Exception as e:
        print(f"DB Error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    return {"deleted": policy_id}


@app.patch("/policies/{policy_id}/toggle")
def toggle_policy(policy_id: int, request: Request = Depends(require_auth), db: Session = Depends(get_db)):
    try:
        policy = db.query(Policy).filter(Policy.id == policy_id).first()
        if not policy:
            raise HTTPException(status_code=404, detail=f"Policy {policy_id} not found")
        policy.active = not policy.active
        db.commit()
    except Exception as e:
        print(f"DB Error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    return policy.to_dict()


# ─── Audit Log ────────────────────────────────────────────────────────────────

@app.get("/audit")
def get_audit_log(
    skip: int = 0,
    limit: int = 50,
    request: Request = Depends(require_auth),
    db: Session = Depends(get_db)
):
    # Validate parameters
    if skip < 0:
        skip = 0
    if limit < 1:
        limit = 10
    
    from models import AuditLog
    try:
        logs = (
            db.query(AuditLog)
            .order_by(AuditLog.timestamp.desc())
            .offset(skip)
            .limit(min(limit, 500))
            .all()
        )
    except Exception as e:
        print(f"DB Error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    return [log.to_dict() for log in logs]


# ─── Step-up ──────────────────────────────────────────────────────────────────

@app.post("/stepup/{challenge_id}/resolve")
async def resolve_stepup(
    challenge_id: str,
    payload: StepUpResolveRequest,
    request: Request = Depends(require_auth),
    db: Session = Depends(get_db),
):
    from step_up import resolve_challenge
    try:
        result = await resolve_challenge(challenge_id, payload.approved, db)
    except Exception as e:
        print(f"DB Error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/stepup/{challenge_id}/status")
def get_stepup_status(challenge_id: str, db: Session = Depends(get_db)):
    from models import StepUpChallenge
    try:
        challenge = db.query(StepUpChallenge).filter(
            StepUpChallenge.challenge_id == challenge_id
        ).first()
    except Exception as e:
        print(f"DB Error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    if not challenge:
        return {"status": "not_found"}
    if challenge.status == "pending" and challenge.is_expired():
        try:
            challenge.status = "expired"
            db.commit()
            db.refresh(challenge)
        except Exception as e:
            print(f"DB Error: {e}")
            raise HTTPException(status_code=500, detail="Database error")
    return {"status": challenge.status}


if __name__ == "__main__":
    import os
    is_dev = os.getenv("ENV", "development") == "development"
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=is_dev)