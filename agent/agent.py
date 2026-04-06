import httpx
import time
import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

_BASE = os.getenv("AGENT_API_URL", "http://localhost:8000")
PROXY_URL = f"{_BASE}/execute"
API_URL = _BASE

GMAIL_USER_ID = os.getenv("GMAIL_USER_ID", "")
GITHUB_USER_ID = os.getenv("GITHUB_USER_ID", "")

pending_stepup: List[Dict[str, Any]] = []

DEMO_ACTIONS: List[Dict[str, Any]] = [
    {
        "action": "read_email",
        "params": {"folder": "inbox", "maxResults": 5},
        "desc": "read_email (5)",
    },
    {
        "action": "read_email",
        "params": {"folder": "inbox", "maxResults": 1000},
        "desc": "read_email (1000)",
    },
    {
        "action": "send_email",
        "params": {
            "to": "team@company.com",
            "subject": "Email Summary",
            "body": "Here are the key emails from today - all clear.",
        },
        "desc": "send_email team",
    },
    {
        "action": "send_email",
        "params": {
            "to": "outsider@gmail.com",
            "subject": "Confidential Summary",
            "body": "FYI here is everything",
        },
        "desc": "send_email external",
    },
    {
        "action": "github_push",
        "params": {
            "repo": "KunalG67/AlgoAscent_cp",
            "branch": "docs/summary",
            "message": "add email summary",
        },
        "desc": "github_push docs",
    },
    {
        "action": "github_push",
        "params": {
            "repo": "KunalG67/AlgoAscent_cp",
            "branch": "main",
            "message": "push summary to main",
        },
        "desc": "github_push main",
    },
    {
        "action": "calendar_write",
        "params": {
            "title": "Team Sync",
            "attendees": 15,
            "duration": 60,
        },
        "desc": "calendar_write",
    },
    {
        "action": "github_delete",
        "params": {
            "repo": "KunalG67/AlgoAscent_cp",
            "branch": "old-branch",
        },
        "desc": "github_delete",
    },
    {
        "action": "send_email",
        "params": {
            "to": "colleague@company.com",
            "subject": "Summary",
            "body": "Here are the findings",
        },
        "desc": "send_email colleague",
    },
    {
        "action": "github_push",
        "params": {
            "repo": "KunalG67/AlgoAscent_cp",
            "branch": "feature/summary",
            "message": "add summary safely",
        },
        "desc": "github_push feature",
    },
]


def _user_id_for_action(action: str) -> str:
    return GITHUB_USER_ID if "github" in action else GMAIL_USER_ID


def _http_error_reason(response: httpx.Response) -> str:
    try:
        data = response.json()
        d = data.get("detail")
        if isinstance(d, list):
            return str(d[0]) if d else response.text
        if isinstance(d, str):
            return d
    except Exception:
        pass
    return response.text or f"HTTP {response.status_code}"


def call_proxy(
    action: str,
    params: dict,
    challenge_id: Optional[str] = None,
) -> dict:
    body: Dict[str, Any] = {
        "action": action,
        "params": params,
        "user_id": _user_id_for_action(action),
    }
    if challenge_id:
        body["challenge_id"] = challenge_id

    try:
        headers = {"X-Agent-Token": os.getenv("AGENT_SECRET", "demo-agent-secret")}
        response = httpx.post(PROXY_URL, json=body, headers=headers, timeout=120.0)
        if not response.is_success:
            return {
                "allowed": False,
                "reason": _http_error_reason(response),
            }
        return response.json()
    except httpx.TimeoutException:
        return {"allowed": False, "reason": "Request to proxy timed out"}
    except Exception as e:
        return {"allowed": False, "reason": str(e)}


def fetch_stepup_status(challenge_id: str) -> str:
    try:
        response = httpx.get(
            f"{API_URL}/stepup/{challenge_id}/status",
            timeout=30.0,
        )
        if not response.is_success:
            return "pending"
        data = response.json()
        return str(data.get("status", "not_found"))
    except Exception:
        return "pending"


def drain_pending_stepups() -> None:
    delay = 2
    attempts = 0
    while pending_stepup:
        progressed = False
        idx = 0
        while idx < len(pending_stepup):
            item = pending_stepup[idx]
            action = item["action"]
            params = item["params"]
            challenge_id = item["challenge_id"]
            rec_idx = item["record_index"]

            status = fetch_stepup_status(challenge_id)

            if status == "pending":
                idx += 1
                continue

            if status == "approved":
                print(f"[STEP-UP APPROVED] retrying {action}")
                result = call_proxy(action, params, challenge_id=challenge_id)
                if result.get("allowed") is True:
                    print(f"  ✓  ALLOWED")
                else:
                    r = result.get("reason", "unknown")
                    print(f"  ✗  BLOCKED  →  {r}")
                pending_stepup.pop(idx)
                progressed = True
                time.sleep(delay)
                if result.get("step_up_required") and result.get("challenge_id"):
                    pending_stepup.append(
                        {
                            "action": action,
                            "params": params,
                            "challenge_id": result["challenge_id"],
                            "record_index": rec_idx,
                        }
                    )
                    print(f"  ⏸  HELD — awaiting your approval on dashboard")
                    print(f"  ↗  Go to dashboard → click REVIEW → approve or deny")
                continue

            print(f"  ✗  BLOCKED  →  step-up {status}")
            pending_stepup.pop(idx)
            progressed = True

        if pending_stepup and not progressed:
            attempts += 1
            if attempts >= 20:
                print("Timeout: step-up polling exceeded 20 attempts")
                break
            time.sleep(3)


def print_final_summary(records: List[Dict[str, Any]]) -> None:
    print()
    print("╔══════════════════════════════════════════════╗")
    print("║            DEMO COMPLETE                     ║")
    print("╚══════════════════════════════════════════════╝")
    print()
    for r in records:
        icon = "✓" if r["outcome"] == "ALLOWED" else "⏸" if r["outcome"] == "STEP-UP" else "✗"
        print(f"  {icon}  [{r['outcome']:<8}]  {r['desc']}")
    print()
    n_blocked = sum(1 for r in records if r["outcome"] == "BLOCKED")
    n_stepup = sum(1 for r in records if r["outcome"] == "STEP-UP")
    n_allowed = sum(1 for r in records if r["outcome"] == "ALLOWED")
    print(f"  ALLOWED  : {n_allowed}")
    print(f"  BLOCKED  : {n_blocked}  ← AgentGate stopped these")
    print(f"  STEP-UP  : {n_stepup}  ← You reviewed these")
    print()
    print("  AgentGate kept the agent within its permission boundaries.")
    print()


if __name__ == "__main__":
    import sys
    pending_stepup.clear()

    demo_mode = "--demo" in sys.argv
    delay = 1

    print()
    print("╔══════════════════════════════════════════════╗")
    print("║         AGENTGATE LIVE DEMO                  ║")
    print("║  Agent: Autonomous Email & Code Assistant    ║")
    print("║  Task:  Summarize emails, push to GitHub     ║")
    print("╚══════════════════════════════════════════════╝")
    print()
    print("  AgentGate is intercepting every action...")
    print("  Watch the dashboard Live Feed →")
    print()
    time.sleep(delay)

    records: List[Dict[str, Any]] = []
    for i, spec in enumerate(DEMO_ACTIONS, start=1):
        action = spec["action"]
        params = spec["params"]
        desc = spec["desc"]

        print(f"  ── Action {i}/10 ──────────────────────────────")
        print(f"  ▶  {desc}")
        result = call_proxy(action, params)
        time.sleep(delay)

        rec = {"n": i, "desc": desc, "outcome": "ALLOWED"}
        records.append(rec)

        if result.get("step_up_required"):
            cid = result.get("challenge_id")
            if cid:
                pending_stepup.append(
                    {
                        "action": action,
                        "params": params,
                        "challenge_id": cid,
                        "record_index": i - 1,
                    }
                )
                rec["outcome"] = "STEP-UP"
                print(f"  ⏸  HELD — awaiting your approval on dashboard")
                print(f"  ↗  Go to dashboard → click REVIEW → approve or deny")
                time.sleep(delay)
            else:
                rec["outcome"] = "BLOCKED"
                print(f"  ✗  BLOCKED — step-up required but no challenge_id returned")
                time.sleep(delay)
            continue

        if result.get("allowed") is True:
            print(f"  ✓  ALLOWED")
            time.sleep(delay)
            continue

        reason = result.get("reason", "blocked by policy")
        rec["outcome"] = "BLOCKED"
        print(f"  ✗  BLOCKED  →  {reason}")
        time.sleep(delay)

    print()
    print("  All actions submitted. Waiting for your step-up decisions...")
    print("  ↗  Check the dashboard for pending approvals")
    print()
    drain_pending_stepups()

    print_final_summary(records)
