import os
import time
import httpx
from dotenv import load_dotenv

load_dotenv()

AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN")
CLIENT_ID = os.getenv("AUTH0_M2M_CLIENT_ID")
CLIENT_SECRET = os.getenv("AUTH0_M2M_CLIENT_SECRET")

GITHUB_CONNECTION = os.getenv("GITHUB_CONNECTION", "github")
GMAIL_CONNECTION = os.getenv("GMAIL_CONNECTION", "google-oauth2")

ACTION_TO_CONNECTION = {
    "send_email":     GMAIL_CONNECTION,
    "read_email":     GMAIL_CONNECTION,
    "read_calendar":  GMAIL_CONNECTION,   # added
    "calendar_write": GMAIL_CONNECTION,   # added
    "github_push":    GITHUB_CONNECTION,
    "github_delete":  GITHUB_CONNECTION,
    "github_pr":      GITHUB_CONNECTION,
}

# ─── M2M token cache ──────────────────────────────────────────────────────────
_m2m_token_cache: dict = {
    "token": None,
    "expires_at": 0,  # unix timestamp
}


async def get_m2m_token() -> str:
    """
    Returns a valid M2M token, using the cached one if still valid.
    Fetches a fresh one from Auth0 if expired or not yet fetched.
    """
    now = time.time()

    # skip fetch if token has >60s left
    if _m2m_token_cache["token"] and _m2m_token_cache["expires_at"] - now > 60:
        return _m2m_token_cache["token"]

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"https://{AUTH0_DOMAIN}/oauth/token",
                json={
                    "grant_type": "client_credentials",
                    "client_id": CLIENT_ID,
                    "client_secret": CLIENT_SECRET,
                    "audience": f"https://{AUTH0_DOMAIN}/api/v2/",
                },
            )

        if response.status_code != 200:
            raise ValueError(
                f"Auth0 M2M token request failed with status {response.status_code}: {response.text}"
            )

        data = response.json()
        token = data.get("access_token")
        expires_in = data.get("expires_in", 86400)  # default 24h

        if not token:
            raise ValueError("Auth0 returned no access_token in M2M response")

        # Cache it
        _m2m_token_cache["token"] = token
        _m2m_token_cache["expires_at"] = now + expires_in

        return token

    except httpx.TimeoutException:
        raise ValueError("Auth0 M2M token request timed out")
    except httpx.RequestError as e:
        raise ValueError(f"Auth0 M2M token network error: {str(e)}")


async def get_token(action: str, user_id: str) -> str:
    """
    Retrieves the OAuth access token for the given action's service
    (Gmail or GitHub) from Auth0 Token Vault for the given user.
    """
    if not user_id or user_id.strip() == "":
        raise ValueError("user_id is required to fetch a token")

    connection = ACTION_TO_CONNECTION.get(action)
    if not connection:
        raise ValueError(f"No Token Vault connection mapped for action: '{action}'")

    m2m_token = await get_m2m_token()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"https://{AUTH0_DOMAIN}/api/v2/users/{user_id}",
                headers={"Authorization": f"Bearer {m2m_token}"},
            )

        if response.status_code == 401:
            # token got invalidated, retry once
            _m2m_token_cache["token"] = None
            _m2m_token_cache["expires_at"] = 0
            fresh_token = await get_m2m_token()

            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    f"https://{AUTH0_DOMAIN}/api/v2/users/{user_id}",
                    headers={"Authorization": f"Bearer {fresh_token}"},
                )

        if response.status_code == 404:
            raise ValueError(f"User '{user_id}' not found in Auth0")

        if response.status_code != 200:
            raise ValueError(
                f"Auth0 Management API returned {response.status_code}: {response.text}"
            )

        data = response.json()
        identities = data.get("identities", [])

        identity = next(
            (i for i in identities if i.get("connection") == connection), None
        )

        if not identity:
            raise ValueError(
                f"No identity found for connection '{connection}' on user '{user_id}'. "
                f"Make sure the user has connected their {connection} account."
            )

        token = identity.get("access_token")
        if not token:
            raise ValueError(
                f"No access_token in identity for connection '{connection}'. "
                f"The user must reconnect their {connection} account at /login"
            )

        # Check if the stored token is already expired
        token_expires_at = identity.get("access_token_expires_at")
        if token_expires_at and token_expires_at < time.time():
            raise ValueError(
                f"The stored access token for '{connection}' has expired. "
                f"Please reconnect your {connection} account at /login"
            )

        return token

    except httpx.TimeoutException:
        raise ValueError(f"Auth0 Management API request timed out for user '{user_id}'")
    except httpx.RequestError as e:
        raise ValueError(f"Auth0 Management API network error: {str(e)}")