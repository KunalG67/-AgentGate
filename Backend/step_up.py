import uuid
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from models import StepUpChallenge
from websocket_manager import broadcast

# Long window so users can use "DECIDE LATER" and the agent can poll indefinitely.
CHALLENGE_EXPIRY_MINUTES = 15


async def create_challenge(action: str, params: dict, db: Session, user_id: str = None) -> str:
    """
    Creates a step-up challenge and broadcasts it to the dashboard.
    """
    now = datetime.utcnow()

    challenge_id = str(uuid.uuid4())
    expires_at = now + timedelta(minutes=CHALLENGE_EXPIRY_MINUTES)

    challenge = StepUpChallenge(
        challenge_id=challenge_id,
        action=action,
        params=params,
        user_id=user_id,
        status="pending",
        created_at=now,
        expires_at=expires_at,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)

    await broadcast({
        "type": "step_up",
        "challenge_id": challenge_id,
        "action": action,
        "params": params,
        "expires_at": expires_at.isoformat(),
    })

    return challenge_id


async def resolve_challenge(challenge_id: str, approved: bool, db: Session) -> dict:
    """
    Resolves a step-up challenge (approve or deny).
    Rejects if already resolved or expired.
    """
    challenge = db.query(StepUpChallenge).filter(
        StepUpChallenge.challenge_id == challenge_id
    ).first()

    if not challenge:
        return {"status": "already_resolved"}

    if challenge.status != "pending":
        return {"status": "already_resolved"}

    if challenge.is_expired():
        challenge.status = "expired"
        db.commit()
        db.refresh(challenge)
        return {"status": "already_resolved"}

    challenge.status = "approved" if approved else "denied"
    challenge.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(challenge)

    await broadcast({
        "type": "step_up_resolved",
        "challenge_id": challenge_id,
        "approved": approved,
        "action": challenge.action,
        "params": challenge.params,
        "reason": challenge.reason if hasattr(challenge, 'reason') else None,
    })

    return {"challenge_id": challenge_id, "status": challenge.status}
