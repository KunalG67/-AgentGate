import os
import secrets
import httpx
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv

load_dotenv()

AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN")
CLIENT_ID = os.getenv("AUTH0_CLIENT_ID")
CLIENT_SECRET = os.getenv("AUTH0_CLIENT_SECRET")
REDIRECT_URI = os.getenv("REDIRECT_URI", "http://localhost:8000/callback")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

router = APIRouter()

def require_auth(request: Request):
    agent_token = request.headers.get("X-Agent-Token")
    if agent_token and agent_token == os.getenv("AGENT_SECRET", "demo-agent-secret"):
        return "agent@demo"
    user = request.cookies.get("ag_auth_user")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user

# ─── In-memory state store for CSRF protection ───────────────────────────────
# state = random token tied to each login attempt
# verified in /callback before processing the code
# simple dict is fine for a single-server demo
_pending_states: dict = {}  # state -> timestamp


def _build_auth_url(connection: str) -> str:
    """Build Auth0 authorize URL with a CSRF state token."""
    state = secrets.token_urlsafe(32)
    _pending_states[state] = datetime.utcnow()
    return (
        f"https://{AUTH0_DOMAIN}/authorize"
        f"?response_type=code"
        f"&client_id={CLIENT_ID}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&scope=openid profile email"
        f"&connection={connection}"
        f"&state={state}"
    )


@router.get("/login")
def login():
    """Redirect user to Auth0 Google OAuth login."""
    return RedirectResponse(_build_auth_url("google-oauth2"))


@router.get("/login/github")
def login_github():
    """Redirect user to Auth0 GitHub OAuth login."""
    return RedirectResponse(_build_auth_url("github"))


@router.get("/callback")
async def callback(
    code: str = None,
    state: str = None,
    error: str = None,
    error_description: str = None,
):
    # ── Handle Auth0 errors ──
    if error:
        raise HTTPException(
            status_code=400,
            detail=f"Auth0 error: {error} — {error_description}"
        )

    if not code:
        raise HTTPException(status_code=400, detail="No authorization code received")

    # ── Validate state to prevent CSRF ──
    if not state or state not in _pending_states:
        raise HTTPException(
            status_code=403,
            detail="Invalid or missing state parameter — possible CSRF attack"
        )
    _pending_states.pop(state, None)  # one-time use
    
    # ── Prune old states to prevent memory leaks ──
    cutoff = datetime.utcnow() - timedelta(hours=1)
    old_states = [s for s, ts in _pending_states.items() if ts < cutoff]
    for old_state in old_states:
        _pending_states.pop(old_state, None)

    # ── Exchange code for tokens ──
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_response = await client.post(
                f"https://{AUTH0_DOMAIN}/oauth/token",
                json={
                    "grant_type": "authorization_code",
                    "client_id": CLIENT_ID,
                    "client_secret": CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": REDIRECT_URI,
                },
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=502, detail="Auth0 token exchange timed out")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Auth0 network error: {str(e)}")

    if token_response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Auth0 token exchange failed: {token_response.text}"
        )

    tokens = token_response.json()

    # ── Validate token response before using it ──
    if "error" in tokens:
        raise HTTPException(
            status_code=400,
            detail=f"Auth0 token error: {tokens.get('error')} — {tokens.get('error_description')}"
        )

    access_token = tokens.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="Auth0 returned no access_token")

    # ── Fetch user info ──
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            user_response = await client.get(
                f"https://{AUTH0_DOMAIN}/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=502, detail="Auth0 userinfo request timed out")

    if user_response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Auth0 userinfo fetch failed: {user_response.text}"
        )

    user = user_response.json()
    user_id = user.get("sub")

    if not user_id:
        raise HTTPException(status_code=502, detail="Auth0 returned no user sub")

    # Store the Auth0 sub (e.g., "google-oauth2|123456") in the cookie
    # This is what Auth0 Management API expects for user lookups
    redir = RedirectResponse(FRONTEND_URL)
    redir.set_cookie(
        key="ag_auth_user",
        value=user_id,
        max_age=60 * 60 * 24 * 7,
        samesite="lax",
        path="/",
        httponly=True,
    )
    return redir