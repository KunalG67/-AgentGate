# AgentGate

**Live Demo:** https://agentgate-red.vercel.app  
**Backend API:** https://agentgate-production-49f2.up.railway.app

## What is AgentGate

AgentGate sits between your AI agents and the outside world. Every time an agent tries to do something (read email, push code, etc.), AgentGate checks if it's allowed. You set the rules. The agent can be allowed through, blocked, or held for your approval.

The demo agent in agent/agent.py simulates a compromised or misconfigured AI assistant running 10 actions. In a real deployment, you would replace this with any AI agent like LangChain, AutoGPT, Claude, GPT-4 with tools, or any custom agent. AgentGate works as a proxy layer - your agent just sends HTTP requests to /execute instead of calling APIs directly. The policy engine, Token Vault integration, step-up auth, and audit trail all work the same regardless of what agent is behind it.

## Demo Video

▶️ [Watch the 3-minute demo](https://youtu.be/VCGC9RMXZN4)

> Shows the full agent demo: 10 actions intercepted, 2 blocked, 2 step-up approvals, live policy enforcement.

## Architecture

```
Agent (Python)
│
│ HTTP POST /execute
▼
AgentGate Backend (FastAPI)
│
├── Policy Engine ──► BLOCKED? Return error immediately
│
├── STEP-UP? ──► React Dashboard (human approves/denies)
│
└── ALLOWED? ──► Auth0 Token Vault (fetch OAuth token)
                 │
         ┌──────┴──────┐
         ▼             ▼
    Gmail API     GitHub API
```

All decisions logged to PostgreSQL  
React Dashboard connects via WebSocket for real-time updates

The flow: Agent sends action to backend. Backend runs it through the policy engine. BLOCKED actions are rejected immediately. STEP-UP actions are held and sent to the React dashboard for human approval. ALLOWED actions fetch OAuth tokens from Auth0 Token Vault at runtime and execute against Gmail or GitHub. Everything is logged to PostgreSQL.

## Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL 13+
- Auth0 account with:
  - Regular Web Application
  - M2M Application (for Token Vault)
  - Google and GitHub social connections
- Groq account

## Environment Variables

Copy `Backend/.env.example` to `Backend/.env` and fill in:

```bash
# Auth0
AUTH0_DOMAIN=your-auth0-domain.us.auth0.com
AUTH0_CLIENT_ID=your-regular-app-client-id
AUTH0_CLIENT_SECRET=your-regular-app-client-secret
AUTH0_M2M_CLIENT_ID=your-m2m-app-client-id
AUTH0_M2M_CLIENT_SECRET=your-m2m-app-client-secret

# Connections
GITHUB_CONNECTION=github
GMAIL_CONNECTION=google-oauth2

# URLs
REDIRECT_URI=http://localhost:8000/callback
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/agentgate

# APIs
GROQ_API_KEY=your-groq-api-key
GEMINI_API_KEY=your-gemini-api-key

# User IDs (from Auth0, with provider prefix)
GMAIL_USER_ID=google-oauth2|your-user-id
GITHUB_USER_ID=github|your-user-id
AUTH0_USER_ID=google-oauth2|your-user-id

# Secrets
WS_TOKEN=your-secure-websocket-token
AGENT_SECRET=your-secure-agent-secret

# Policy config
ALLOWED_CONTACTS=email1@example.com,email2@example.com
ALLOWED_DOMAINS=company.com,trusted.com

# Environment
ENV=development
```

## How to Run Locally

Backend:
```bash
cd Backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -c "from database import init_db; init_db()"
python main.py
```
Runs on http://localhost:8000

Frontend:
```bash
cd frontend
npm install
npm start
```
Runs on http://localhost:3000

Agent:
```bash
cd agent
pip install httpx python-dotenv
python agent.py --demo
```

## How it Works

Three possible outcomes for every agent action:

ALLOWED: No blocking rules match. Action executes immediately. Logged to audit trail.

BLOCKED: Matches a BLOCK rule. Action is rejected. Agent gets a reason.

STEP-UP: Matches a BLOCK+STEPUP rule. Action is held for human approval. Challenge appears in the dashboard. Human reviews and approves/denies. If approved, action executes. If denied, it's blocked.

## Auth0 Token Vault Integration

OAuth tokens are never stored in AgentGate's database. They're pulled from Auth0 at runtime.

How it works:
1. User logs in via Auth0 and connects Gmail/GitHub
2. Auth0 stores the OAuth tokens
3. When AgentGate needs to execute:
   - Authenticates to Auth0 via M2M
   - Fetches the OAuth token from Token Vault
   - Uses it to call Gmail/GitHub
   - Token is not cached locally

This means:
- Tokens aren't in the database
- Revoke from Auth0 dashboard and it's instant
- No token leakage if database is compromised

## Demo Scenario

The demo agent runs 10 actions:

1. read_email (5 messages) → ALLOWED
2. read_email (1000 messages) → BLOCKED (exceeds limit)
3. send_email to team@company.com → ALLOWED
4. send_email to outsider@gmail.com → STEP-UP (external domain)
5. github_push to docs branch → ALLOWED
6. github_push to main → BLOCKED (protected branch)
7. calendar_write (15 attendees) → BLOCKED (too many)
8. github_delete branch → STEP-UP (destructive)
9. send_email to colleague@company.com → ALLOWED
10. github_push to feature branch → ALLOWED

Run it:
```bash
cd agent
python agent.py --demo
```

Watch the Live Feed dashboard to see actions get intercepted and either pass through, get blocked, or wait for your approval.
