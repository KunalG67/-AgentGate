import os
import re
from models import Policy
from sqlalchemy.orm import Session
from dataclasses import dataclass
from typing import Any, List, Optional, Tuple
from datetime import datetime, timezone


# Cache environment variables at module load time
_ALLOWED_CONTACTS = os.getenv("ALLOWED_CONTACTS", "")
_ALLOWED_DOMAINS = os.getenv("ALLOWED_DOMAINS", "company.com,trusted.com")


@dataclass
class PolicyResult:
    allowed: bool
    rule_id: Optional[int] = None
    reason: Optional[str] = None
    step_up_required: bool = False


def get_trusted_contacts() -> list:
    raw = _ALLOWED_CONTACTS
    if not raw.strip():
        return []
    return [email.strip().lower() for email in raw.split(",") if email.strip()]


def _trusted_domains() -> set:
    raw = _ALLOWED_DOMAINS
    parts = [p.strip().lower() for p in raw.split(",") if p.strip()]
    return set(parts) if parts else {"company.com", "trusted.com"}


def _log(condition: str, params: dict, result: bool) -> bool:
    print(f"[policy] condition='{condition}' params={params} result={result}")
    return result


def _parse_scalar(token: str) -> Any:
    t = token.strip()
    if (t.startswith("'") and t.endswith("'")) or (t.startswith('"') and t.endswith('"')):
        return t[1:-1]
    tl = t.lower()
    if tl == "true":
        return True
    if tl == "false":
        return False
    if tl == "null" or tl == "none":
        return None
    try:
        if re.fullmatch(r"-?\d+", t):
            return int(t)
        if re.fullmatch(r"-?\d+\.\d+", t):
            return float(t)
    except ValueError:
        pass
    return t


def _param_value(params: dict, field: str) -> Any:
    return params.get(field)


def _numeric_for_compare(v: Any) -> Tuple[Optional[float], bool]:
    if v is None:
        return None, False
    if isinstance(v, bool):
        return float(v), True
    if isinstance(v, (int, float)):
        return float(v), True
    if isinstance(v, list):
        return float(len(v)), True
    try:
        return float(int(str(v))), True
    except (TypeError, ValueError):
        try:
            return float(str(v)), True
        except (TypeError, ValueError):
            return None, False


def _compare(op: str, left: Any, right: Any) -> Optional[bool]:
    ln, lok = _numeric_for_compare(left)
    rn, rok = _numeric_for_compare(right)
    if op in (">", "<", ">=", "<=") and lok and rok:
        if op == ">":
            return ln > rn
        if op == "<":
            return ln < rn
        if op == ">=":
            return ln >= rn
        if op == "<=":
            return ln <= rn
    if op == "=":
        return left == right
    if op == "!=":
        return left != right
    if op == ">" and lok and rok:
        return ln > rn
    if op == "<" and lok and rok:
        return ln < rn
    if op == ">=" and lok and rok:
        return ln >= rn
    if op == "<=" and lok and rok:
        return ln <= rn
    return None


def _unknown_sender_predicate(params: dict) -> bool:
    to_addr = str(params.get("to", "")).strip().lower()
    if not to_addr:
        return True
    if "@" not in to_addr:
        return True
    dom = to_addr.split("@", 1)[1].strip()
    return dom not in _trusted_domains()


def _parse_not_in_list(rhs: str) -> List[str]:
    name = rhs.strip()
    nl = name.lower()
    if nl == "contacts":
        return list(get_trusted_contacts())
    inner = name.strip()
    if (inner.startswith("(") and inner.endswith(")")) or (inner.startswith("[") and inner.endswith("]")):
        inner = inner[1:-1]
    return [x.strip().strip("'\"").lower() for x in inner.split(",") if x.strip()]


def _eval_domain_equals(rhs_raw: str, params: dict) -> bool:
    rhs = _parse_scalar(rhs_raw.strip())
    if not isinstance(rhs, str):
        rhs = str(rhs)
    rhs = rhs.lower().strip()
    suffix = rhs if rhs.startswith("@") else f"@{rhs}"
    to_addr = str(params.get("to", "")).strip().lower()
    return to_addr.endswith(suffix)


def _eval_time_not_between(params: dict, rest: str) -> Optional[bool]:
    try:
        parts = rest.strip().split("-", 1)
        if len(parts) != 2:
            return None
        start_hour = int(parts[0].split(":")[0].strip())
        end_hour = int(parts[1].split(":")[0].strip())
        now_hour = datetime.now(timezone.utc).hour
        return not (start_hour <= now_hour < end_hour)
    except (ValueError, IndexError):
        return None


def _eval_predicate(condition: str, params: dict) -> Optional[bool]:
    s = condition.strip()
    if not s:
        return None

    sul = s.lower()
    if sul == "any":
        return True

    if sul in ("unknown_sender", "unknown sender", "recipient:unknown", "recipient_unknown"):
        return _unknown_sender_predicate(params)

    m_tb = re.match(r"^time\s+NOT\s+BETWEEN\s+(.+)$", s, re.I)
    if m_tb:
        r = _eval_time_not_between(params, m_tb.group(1))
        return r

    m_dom = re.match(r"^domain\s*=\s*(.+)$", s, re.I)
    if m_dom:
        return _eval_domain_equals(m_dom.group(1), params)

    m_ni = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s+NOT\s+IN\s+(.+)$", s, re.I)
    if m_ni:
        field = m_ni.group(1)
        raw_list = m_ni.group(2).strip()
        bucket = set(_parse_not_in_list(raw_list))
        val = _param_value(params, field)
        if isinstance(val, (list, tuple, set)) and not isinstance(val, str):
            return not any(str(x).strip().lower() in bucket for x in val)
        sv = str(val).strip().lower() if val is not None else ""
        return sv not in bucket

    m_ct = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s+contains\s+(.+)$", s, re.I)
    if m_ct:
        field = m_ct.group(1)
        needle = _parse_scalar(m_ct.group(2))
        hay = _param_value(params, field)
        h = "" if hay is None else (hay if isinstance(hay, str) else str(hay))
        n = "" if needle is None else str(needle)
        return n.lower() in h.lower()

    m_rc = re.match(r"^recipient\s*==\s*(.+)$", s, re.I)
    if m_rc:
        needle = str(_parse_scalar(m_rc.group(1))).lower()
        to_addr = str(params.get("to", "")).strip().lower()
        return needle in to_addr

    m_cmp = re.match(
        r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*(>=|<=|!=|>|<|=)\s*(.+)$",
        s,
    )
    if m_cmp:
        field = m_cmp.group(1)
        op = m_cmp.group(2)
        rhs_tok = m_cmp.group(3).strip()
        left = _param_value(params, field)
        right = _parse_scalar(rhs_tok)
        if field.lower() in ("github_branch",) and left is None:
            left = params.get("branch")
        if field.lower() in ("count",) and left is None:
            left = params.get("maxResults")
        cmp_r = _compare(op, left, right)
        if cmp_r is not None:
            return cmp_r
        if op == "=":
            return left == right
        if op == "!=":
            return left != right
        return None

    return None


def check_condition(condition: str, params: dict) -> bool:
    s0 = condition.strip()
    sl = s0.lower()

    if sl.startswith("!recipient=="):
        try:
            needle = _parse_scalar(s0.split("==", 1)[1].strip())
            needle = str(needle).lower()
        except (IndexError, TypeError):
            return _log(condition, params, False)
        to_addr = str(params.get("to", "")).strip().lower()
        return _log(condition, params, needle not in to_addr)

    if sl.startswith("!to:"):
        try:
            needle = _parse_scalar(s0.split(":", 1)[1].strip())
            needle = str(needle).lower()
        except (IndexError, TypeError):
            return _log(condition, params, False)
        to_addr = str(params.get("to", "")).strip().lower()
        return _log(condition, params, needle not in to_addr)

    if s0.startswith("!"):
        inner = s0[1:].strip()
        inner_res = _eval_predicate(inner, params)
        if inner_res is None:
            return _log(condition, params, False)
        return _log(condition, params, not inner_res)

    res = _eval_predicate(s0, params)
    if res is None:
        return _log(condition, params, False)
    return _log(condition, params, res)


def evaluate_policy(action: str, params: dict, db: Session) -> PolicyResult:
    rules = (
        db.query(Policy)
        .filter(Policy.action == action, Policy.active == True)
        .all()
    )

    block_rules = [r for r in rules if (r.effect or "").strip().upper() != "ALLOW"]
    allow_rules = [r for r in rules if (r.effect or "").strip().upper() == "ALLOW"]

    for rule in block_rules:
        if check_condition(rule.condition, params):
            eff = (rule.effect or "").strip().upper()
            return PolicyResult(
                allowed=False,
                rule_id=rule.id,
                reason=rule.reason,
                step_up_required=(eff == "BLOCK+STEPUP"),
            )

    for rule in allow_rules:
        if check_condition(rule.condition, params):
            return PolicyResult(
                allowed=True,
                rule_id=rule.id,
                reason=rule.reason,
                step_up_required=False,
            )

    return PolicyResult(allowed=True)
