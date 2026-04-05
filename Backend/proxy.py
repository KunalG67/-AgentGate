import os
from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from policy_engine import evaluate_policy
from token_vault import get_token
from executor import execute_action
from websocket_manager import broadcast, manager
from step_up import create_challenge
from models import AuditLog, StepUpChallenge
from datetime import datetime, timedelta
from slowapi import Limiter
from slowapi.util import get_remote_address
from auth import require_auth

router = APIRouter()

# Single limiter instance — main.py imports this same object and sets app.state.limiter
# This is critical: slowapi requires decorator and app.state to share ONE instance
limiter = Limiter(key_func=get_remote_address)

# Simple token for WebSocket auth — set WS_TOKEN in your .env
WS_TOKEN = os.getenv("WS_TOKEN", "agentgate-demo-token")


class ActionRequest(BaseModel):
    action: str
    params: dict = {}
    user_id: str  # required — no default, forces caller to always send it
    challenge_id: Optional[str] = None  # sent on retry after step-up approval


@router.post("/execute")
@limiter.limit("30/minute")
async def execute(request: Request, body: ActionRequest, current_user: str = Depends(require_auth), db: Session = Depends(get_db)):
    # request = FastAPI Request object, required by slowapi — do NOT remove it
    # current_user = authenticated user from cookie

    # --- 0. Validate user_id ---
    if not body.user_id or body.user_id.strip() == "":
        raise HTTPException(status_code=400, detail="user_id is required")

    # --- 1. Step-up gate: if caller provides challenge_id, enforce challenge status ---
    if body.challenge_id:
        challenge = db.query(StepUpChallenge).filter(
            StepUpChallenge.challenge_id == body.challenge_id
        ).first()

        if not challenge:
            return {"allowed": False, "reason": "denied by user"}

        if challenge.status == "pending" and challenge.expires_at <= datetime.utcnow():
            challenge.status = "expired"
            db.commit()

        if challenge.status == "pending":
            return {"allowed": False, "reason": "awaiting approval"}

        if challenge.status in ("denied", "expired", "consumed"):
            # Log the denial in audit log
            denial_log = AuditLog(
                action=challenge.action,
                params=challenge.params,
                allowed=False,
                reason=f"Step-up {challenge.status} by user",
                user_id=current_user,
                step_up_required=True,
            )
            db.add(denial_log)
            db.commit()
            db.refresh(denial_log)
            await broadcast({
                "type": "action",
                "action": challenge.action,
                "params": challenge.params,
                "allowed": False,
                "reason": f"Step-up {challenge.status} by user",
                "timestamp": denial_log.timestamp.isoformat(),
            })
            return {"allowed": False, "reason": "denied by user"}

        if challenge.status != "approved":
            return {"allowed": False, "reason": "denied by user"}

        # one-time use only
        challenge.status = "consumed"
        db.commit()

        # skip policy check, go straight to execution
        log_entry = AuditLog(
            action=body.action,
            params=body.params,
            allowed=True,
            rule_id=None,
            reason="Step-up approved by user",
            step_up_required=True,
            step_up_approved=True,
        )
        db.add(log_entry)
        db.commit()
        db.refresh(log_entry)

        await broadcast({"type": "action", "data": log_entry.to_dict()})

        try:
            token = await get_token(body.action, body.user_id)
            api_result = await execute_action(body.action, body.params, token)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Execution failed: {str(e)}")

        log_entry.result = api_result
        db.commit()

        return {"allowed": True, "result": api_result}

    # --- 2. Normal path: run policy check ---
    result = evaluate_policy(body.action, body.params, db)

    # --- 3. Build audit entry ---
    log_entry = AuditLog(
        action=body.action,
        params=body.params,
        allowed=result.allowed,
        rule_id=result.rule_id,
        reason=result.reason,
        step_up_required=result.step_up_required,
        step_up_approved=False,
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)

    # --- 4. Broadcast to dashboard ---
    await broadcast({"type": "action", "data": log_entry.to_dict()})

    # --- 5. Block or execute ---
    if not result.allowed:
        if result.step_up_required:
            challenge_id = await create_challenge(
                body.action, body.params, db, user_id=body.user_id
            )
            return {
                "allowed": False,
                "step_up_required": True,
                "challenge_id": challenge_id,
                "reason": result.reason,
            }
        return {"allowed": False, "reason": result.reason}

    # --- 6. Get token and execute ---
    try:
        token = await get_token(body.action, body.user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Token retrieval failed: {str(e)}")

    try:
        api_result = await execute_action(body.action, body.params, token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Execution failed: {str(e)}")

    # --- 7. Update log with result ---
    log_entry.result = api_result
    db.commit()

    return {"allowed": True, "result": api_result}


# WebSocket authentication via query token
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    if token != WS_TOKEN:
        await websocket.close(code=1008)  # 1008 = policy violation
        return
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)