import httpx
import re
import base64
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


async def execute_action(action: str, params: dict, token: str) -> dict:
    if action == "send_email":
        return await send_email(params, token)
    if action == "read_email":
        return await read_email(params, token)
    if action == "read_calendar":
        return await read_calendar(params, token)
    if action == "calendar_write":
        return await calendar_write(params, token)
    if action == "github_push":
        return await github_push(params, token)
    if action == "github_delete":
        return await github_delete(params, token)
    return {"status": "error", "message": f"No executor found for action: {action}"}


async def send_email(params: dict, token: str) -> dict:
    """
    Actually sends an email via the Gmail API using messages.send.
    params: { to, subject, body }
    """
    to = params.get("to", "")
    subject = params.get("subject", "(no subject)")
    body = params.get("body", "")

    if not to:
        return {"status": "error", "message": "Missing 'to' field in params"}

    msg = MIMEMultipart("alternative")
    msg["to"] = to
    msg["from"] = "me"
    msg["subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                headers={"Authorization": f"Bearer {token}"},
                json={"raw": raw},
            )

        if response.status_code not in (200, 201):
            return {
                "status": "error",
                "message": f"Gmail API returned {response.status_code}",
                "detail": response.text,
            }

        data = response.json()
        return {
            "status": "sent",
            "to": to,
            "subject": subject,
            "messageId": data.get("id"),
            "threadId": data.get("threadId"),
        }

    except httpx.TimeoutException:
        return {"status": "error", "message": "Gmail API request timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def read_email(params: dict, token: str) -> dict:
    """
    Lists recent messages from the Gmail inbox.
    params: { maxResults (default 5) }
    """
    max_results = params.get("maxResults", 5)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                headers={"Authorization": f"Bearer {token}"},
                params={"maxResults": max_results},
            )

            if response.status_code != 200:
                return {
                    "status": "error",
                    "message": f"Gmail API returned {response.status_code}",
                    "detail": response.text,
                }

            data = response.json()
            messages_list = data.get("messages", [])[:5]
            full_messages = []
            for msg in messages_list:
                msg_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg['id']}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date"
                msg_resp = await client.get(msg_url, headers={"Authorization": f"Bearer {token}"})
                if msg_resp.status_code == 200:
                    msg_data = msg_resp.json()
                    hdrs = msg_data.get("payload", {}).get("headers", [])
                    subject = next((h["value"] for h in hdrs if h["name"] == "Subject"), "(no subject)")
                    sender = next((h["value"] for h in hdrs if h["name"] == "From"), "unknown")
                    full_messages.append({"id": msg["id"], "subject": subject, "from": sender})
            return {"status": "ok", "count": len(full_messages), "messages": full_messages}

    except httpx.TimeoutException:
        return {"status": "error", "message": "Gmail API request timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def read_calendar(params: dict, token: str) -> dict:
    """
    Lists upcoming events from the user's primary Google Calendar.
    params: { maxResults (default 10) }
    """
    max_results = params.get("maxResults", 10)
    time_min = datetime.now(timezone.utc).isoformat()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "maxResults": max_results,
                    "orderBy": "startTime",
                    "singleEvents": True,
                    "timeMin": time_min,
                },
            )

        if response.status_code != 200:
            return {
                "status": "error",
                "message": f"Calendar API returned {response.status_code}",
                "detail": response.text,
            }

        data = response.json()
        events = data.get("items", [])

        return {
            "status": "ok",
            "count": len(events),
            "events": [
                {
                    "summary": e.get("summary", "(no title)"),
                    "start": e.get("start"),
                    "end": e.get("end"),
                    "attendees": [
                        a.get("email") for a in e.get("attendees", [])
                    ],
                    "eventId": e.get("id"),
                }
                for e in events
            ],
        }

    except httpx.TimeoutException:
        return {"status": "error", "message": "Calendar API request timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def calendar_write(params: dict, token: str) -> dict:
    """
    Creates a new event in the user's primary Google Calendar.
    params: { summary, start, end, attendees (list of emails) }
    """
    title = params.get("title") or params.get("summary") or "New Event"
    start = params.get("start")
    end = params.get("end")
    raw_attendees = params.get("attendees", [])
    if isinstance(raw_attendees, list):
        attendees_list = [{"email": e} for e in raw_attendees if isinstance(e, str)]
    else:
        attendees_list = []  # if it's a count integer, we can't use it as emails

    if not start or not end:
        return {"status": "error", "message": "Missing 'start' or 'end' in params"}

    event_body = {
        "summary": title,
        "start": {"dateTime": start, "timeZone": "UTC"},
        "end":   {"dateTime": end,   "timeZone": "UTC"},
        "attendees": attendees_list,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                headers={"Authorization": f"Bearer {token}"},
                json=event_body,
            )

        if response.status_code not in (200, 201):
            return {
                "status": "error",
                "message": f"Calendar API returned {response.status_code}",
                "detail": response.text,
            }

        data = response.json()
        return {
            "status": "created",
            "eventId":  data.get("id"),
            "summary":  data.get("summary"),
            "start":    data.get("start"),
            "end":      data.get("end"),
            "link":     data.get("htmlLink"),
            "attendees": [
                a.get("email") for a in data.get("attendees", [])
            ],
        }

    except httpx.TimeoutException:
        return {"status": "error", "message": "Calendar API request timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def github_push(params: dict, token: str) -> dict:
    """
    Creates or updates a file in a GitHub repo using the Contents API.
    params: { repo, branch, message, filename (default agentgate-notes.md), content (optional) }
    """
    repo = params.get("repo")
    branch = params.get("branch", "main")
    commit_message = params.get("message", "update via AgentGate")
    filename = params.get("filename", "agentgate-notes.md")
    file_content = params.get("content", f"# AgentGate Notes\n\n{commit_message}\n")

    if not repo:
        return {"status": "error", "message": "Missing 'repo' field in params"}

    # Sanitize repo and branch
    repo = re.sub(r'[^a-zA-Z0-9\-\_\/\.]', '', repo)
    branch = re.sub(r'[^a-zA-Z0-9\-\_\/\.]', '', branch)
    if not repo or not branch:
        return {"status": "error", "message": "Invalid repo or branch"}

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    encoded_content = base64.b64encode(file_content.encode("utf-8")).decode("utf-8")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            check_response = await client.get(
                f"https://api.github.com/repos/{repo}/contents/{filename}",
                headers=headers,
                params={"ref": branch},
            )

            payload = {
                "message": commit_message,
                "content": encoded_content,
                "branch": branch,
            }

            if check_response.status_code == 200:
                existing_sha = check_response.json().get("sha")
                if existing_sha:
                    payload["sha"] = existing_sha

            put_response = await client.put(
                f"https://api.github.com/repos/{repo}/contents/{filename}",
                headers=headers,
                json=payload,
            )

        if put_response.status_code not in (200, 201):
            return {
                "status": "error",
                "message": f"GitHub API returned {put_response.status_code}",
                "detail": put_response.text,
            }

        data = put_response.json()
        commit = data.get("commit", {})
        return {
            "status": "pushed",
            "repo": repo,
            "branch": branch,
            "file": filename,
            "commit_sha": commit.get("sha", "")[:7],
            "commit_message": commit_message,
            "url": commit.get("html_url", ""),
        }

    except httpx.TimeoutException:
        return {"status": "error", "message": "GitHub API request timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def github_delete(params: dict, token: str) -> dict:
    """
    Deletes a branch from a GitHub repo.
    params: { repo, branch }
    """
    repo = params.get("repo")
    branch = params.get("branch")

    if not repo or not branch:
        return {"status": "error", "message": "Missing 'repo' or 'branch' in params"}

    # Sanitize repo and branch
    repo = re.sub(r'[^a-zA-Z0-9\-\_\/\.]', '', repo)
    branch = re.sub(r'[^a-zA-Z0-9\-\_\/\.]', '', branch)
    if not repo or not branch:
        return {"status": "error", "message": "Invalid repo or branch"}

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                f"https://api.github.com/repos/{repo}/git/refs/heads/{branch}",
                headers=headers,
            )

        if response.status_code == 422:
            return {"status": "error", "message": f"Branch '{branch}' not found or already deleted"}
        if response.status_code not in (200, 204):
            return {
                "status": "error",
                "message": f"GitHub API returned {response.status_code}",
                "detail": response.text,
            }

        return {"status": "deleted", "repo": repo, "branch": branch}

    except httpx.TimeoutException:
        return {"status": "error", "message": "GitHub API request timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}