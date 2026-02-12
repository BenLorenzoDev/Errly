# Errly — Error Observability for Railway Projects

> "Deploy once. See every error. Fix faster."

## Overview

Errly is a standalone, self-hosted error observability service designed as a Railway template. It provides real-time visibility into errors across all services in a Railway project — with zero code changes required.

## The Problem

- Tracing errors across multiple Railway services is painful
- Scrolling through walls of logs to find the needle in the haystack
- Copying entire service logs to debug with AI tools hits context limits
- No single place to see errors from ALL services at once

## The Solution

Deploy Errly into any Railway project. It automatically watches all services' log streams, catches errors, and presents them in a clean dashboard. One-click copy formats errors perfectly for AI-assisted debugging.

---

## User Journey

1. Browse Railway templates, find Errly, click Deploy
2. Set two env vars: `ERRLY_PASSWORD`, `RAILWAY_API_TOKEN`
3. Optionally generate a custom domain: `errly.yourproject.com`
4. Open the dashboard — errors from all services are already streaming in
5. See a problem, hit "Copy for Claude", paste, get answers

---

## Core Features

### Real-time Error Feed

- Live stream of errors from every service in the project
- Each error card shows: service name, error message, timestamp, severity
- Expand for full stack trace and context
- New errors appear instantly via SSE — no refresh needed

### Smart Grouping

- Same error repeating 200 times? One card, one count badge
- Groups by error message + service + stack trace fingerprint
- "First seen" and "Last seen" timestamps so you know if it's new or ongoing

### Filtering & Search

- Filter by service name, severity, time range
- Search across error messages and stack traces
- Quick toggles: "Last hour", "Last 24h", "This week"

### Copy for Claude (Killer Feature)

One button formats the error perfectly for AI-assisted debugging:

```
[Errly Error Report]
Service: auth-service
Severity: error
Occurred: 47 times (first: 10:23am, last: 10:31am)
Endpoint: POST /api/auth/refresh
Error: TokenExpiredError: jwt expired
Stack trace:
  at verifyToken (src/middleware/auth.ts:45)
  at refreshHandler (src/routes/auth.ts:112)
  ...
Related errors from other services in the same timeframe:
  - gateway: 502 Bad Gateway on /api/auth/refresh (38 times)
```

The "related errors" section connects the dots across services automatically.

### Auto-Capture Mode (Plug-and-Play)

- Connects via Railway API token
- Watches log streams from ALL services in the project automatically
- Pattern-matches errors: stack traces, `[ERROR]`, uncaught exceptions, non-zero exit codes
- Works with any language, any framework, zero code changes
- This is the default mode — works the moment you deploy

### Direct Integration Mode (Optional Upgrade)

- `POST /api/errors` endpoint accepts structured JSON payloads
- Richer data: request context, headers, user info, custom metadata
- Simple snippet — 5 lines of code in any language
- For Node.js: a one-liner Express middleware
- Optional — only for services where you want deeper insight

### Settings Dashboard

- Retention period: 24h / 7 days / 30 days / custom
- Password management
- Railway API token configuration
- Service aliases (rename `auth-service-production-abc123` to just `auth-service`)
- Error notifications — optional webhook URL when new error types appear

---

## Tech Stack

- **Runtime**: Single Node.js service (Express or Fastify)
- **Database**: SQLite (zero-config, portable, template-friendly)
- **Frontend**: Bundled and served from the same service (no separate client deploy)
- **Real-time**: SSE (Server-Sent Events) for streaming errors to the UI
- **Deployment**: One Dockerfile, one Railway service

---

## Auth

- Simple password-based auth via environment variable
- `ERRLY_PASSWORD` env var — set it and the dashboard requires login
- Password entry sets a session cookie
- No user management, no OAuth — it's a devtool, not a SaaS

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ERRLY_PASSWORD` | Yes | Password to access the dashboard |
| `RAILWAY_API_TOKEN` | Yes | Railway API token for auto-capture mode |
| `PORT` | No | Port to run on (default: 3000, Railway sets this automatically) |

---

## What Makes Errly Different

| Feature | Errly | Sentry/Datadog/etc |
|---------|-------|--------------------|
| Pricing | Free, self-hosted | Per-event pricing / monthly bills |
| Setup | 2 env vars, done | SDK installation per service |
| Railway-native | Built for Railway | Generic, requires configuration |
| AI-optimized | Copy for Claude button | Not designed for AI workflows |
| Resource usage | Lightweight (one service + SQLite) | Heavy infrastructure |
| Code changes | Zero required (auto-capture) | SDK required in every service |

---

## Future Vision

- **Railway Template**: One-click deploy from Railway's template marketplace
- **Productization**: Potential standalone product for the Railway ecosystem
- **Custom domains**: `status.yourproject.com` or `errly.yourproject.com`

---

## First User: CallView AI MS

Errly will be battle-tested on CallView AI MS, a monorepo with 8+ microservices on Railway. This provides:
- Real-world validation with a production system
- Multi-service error correlation testing
- Direct feedback loop for feature refinement
