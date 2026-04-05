from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, Index
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime, timedelta

Base = declarative_base()


class Policy(Base):
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String, nullable=False, index=True)   # indexed — filtered on every request
    condition = Column(String, nullable=False)
    effect = Column(String, nullable=False)
    reason = Column(String, nullable=False)
    active = Column(Boolean, default=True, index=True)    # indexed — filtered on every request
    created_at = Column(DateTime, default=lambda: datetime.utcnow())

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Validate effect field
        valid_effects = {"BLOCK", "BLOCK+STEPUP", "ALLOW"}
        if hasattr(self, 'effect') and self.effect not in valid_effects:
            raise ValueError("Invalid effect value")

    def to_dict(self):
        return {
            "id": self.id,
            "action": self.action,
            "condition": self.condition,
            "effect": self.effect,
            "reason": self.reason,
            "active": self.active,
            "created_at": self.created_at.isoformat(),
        }


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.utcnow(), index=True)  # indexed — sorted on every fetch
    action = Column(String, nullable=False, index=True)
    params = Column(JSON, nullable=True)
    allowed = Column(Boolean, nullable=False)
    rule_id = Column(Integer, nullable=True)
    reason = Column(String, nullable=True)
    step_up_required = Column(Boolean, default=False)
    step_up_approved = Column(Boolean, default=False)    # now properly set to True when approved
    result = Column(JSON, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat(),
            "action": self.action,
            "params": self.params,
            "allowed": self.allowed,
            "rule_id": self.rule_id,
            "reason": self.reason,
            "step_up_required": self.step_up_required,
            "step_up_approved": self.step_up_approved,
            "result": self.result,
        }


class StepUpChallenge(Base):
    __tablename__ = "step_up_challenges"

    id = Column(Integer, primary_key=True, index=True)
    challenge_id = Column(String, unique=True, index=True)
    action = Column(String, nullable=False)
    params = Column(JSON, nullable=True)
    user_id = Column(String, nullable=True)              # track which user triggered it
    status = Column(String, default="pending", index=True)
    created_at = Column(DateTime, default=lambda: datetime.utcnow())
    resolved_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, default=lambda: datetime.utcnow() + timedelta(minutes=15), nullable=False)         # set to created_at + 15 min on creation

    def to_dict(self):
        return {
            "id": self.id,
            "challenge_id": self.challenge_id,
            "action": self.action,
            "params": self.params,
            "user_id": self.user_id,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
        }

    def is_expired(self) -> bool:
        """Returns True if this challenge is past its expiry time."""
        if not self.expires_at:
            return False
        return datetime.utcnow() >= self.expires_at


# Composite index for the most common policy query:
# SELECT * FROM policies WHERE action = ? AND active = true
Index("ix_policies_action_active", Policy.action, Policy.active)

# Composite index for audit log queries sorted by time
Index("ix_audit_timestamp_action", AuditLog.timestamp, AuditLog.action)