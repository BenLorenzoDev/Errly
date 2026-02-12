# Errly

**Self-hosted error observability for Railway projects.**

Deploy once into any Railway project. Errly automatically watches all services' log streams, catches errors, groups them, and presents them in a real-time dashboard. Zero code changes required.

## Features

- **Auto-Capture** — Connects via Railway API, subscribes to log streams from every service, and pattern-matches errors (stack traces, `[ERROR]`, uncaught exceptions). Works with any language, any framework.
- **Smart Grouping** — Deduplicates errors by fingerprint (message + service + stack trace). Shows occurrence count, first/last seen timestamps.
- **Real-Time Dashboard** — Errors appear instantly via SSE. Filter by service, severity, status, or search across messages and stack traces.
- **Copy for Claude** — One-click formats errors with full context (service, stack trace, occurrence count, related cross-service errors) for AI-assisted debugging.
- **Direct Integration** — Optional `POST /api/errors` endpoint for structured error payloads with richer context.
- **Webhook Notifications** — Get notified (Slack, Discord, etc.) when new error types appear.
- **Configurable Retention** — 24h, 7 days, 30 days, or custom. Automatic cleanup.

## Quick Start

### Deploy to Railway

1. Click **Deploy on Railway** (or fork this repo and connect it)
2. Set the required environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `ERRLY_PASSWORD` | Yes | Password to access the dashboard |
| `RAILWAY_API_TOKEN` | Yes | Railway API token for auto-capture |
| `RAILWAY_PROJECT_ID` | Auto | Detected automatically on Railway |
| `RAILWAY_ENVIRONMENT_NAME` | Auto | Detected automatically on Railway |

3. Open your Errly URL — errors are already streaming in

### Run Locally

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your ERRLY_PASSWORD and RAILWAY_API_TOKEN

# Start dev server (API + Vite HMR)
npm run dev
```

The dashboard runs at `http://localhost:5173`, API at `http://localhost:3000`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ERRLY_PASSWORD` | — | Dashboard login password |
| `RAILWAY_API_TOKEN` | — | Railway API token for log subscriptions |
| `RAILWAY_PROJECT_ID` | auto-detected | Railway project to monitor |
| `RAILWAY_ENVIRONMENT_NAME` | auto-detected | Environment to filter (e.g. `production`) |
| `RAILWAY_SERVICE_ID` | auto-detected | Errly's own service ID (excluded from monitoring) |
| `PORT` | `3000` | Server port |
| `ERRLY_DB_PATH` | `./data/errly.db` | SQLite database path |
| `ERRLY_MAX_SUBSCRIPTIONS` | `50` | Max concurrent log subscriptions |
| `ERRLY_MAX_SSE_CLIENTS` | `100` | Max concurrent dashboard connections |

## Tech Stack

- **Server**: Fastify 5, TypeScript, ESM
- **Database**: SQLite via better-sqlite3 + Drizzle ORM
- **Frontend**: React 19, Vite, Tailwind CSS v4
- **Real-time**: SSE (Server-Sent Events)
- **Railway Integration**: GraphQL HTTP + WebSocket (graphql-ws)
- **Deployment**: Multi-stage Dockerfile, single Railway service

## Architecture

```
Railway Project
├── your-api-service ──────┐
├── your-worker-service ───┤  log streams (GraphQL WS)
├── your-frontend-service ─┤
└── Errly ◄────────────────┘
    ├── Log Watcher (auto-discovery, subscriptions)
    ├── Log Parser (stack trace reassembly)
    ├── Error Grouper (fingerprint + dedup)
    ├── SQLite Store (errors, settings, sessions)
    ├── SSE Broadcaster (real-time to dashboard)
    └── React Dashboard (filter, search, copy)
```

## API

### Direct Error Ingestion

```bash
POST /api/errors
Content-Type: application/json

{
  "message": "TypeError: Cannot read property 'id' of undefined",
  "stackTrace": "at handler (src/routes/users.ts:42)\n...",
  "severity": "error",
  "serviceName": "api-service",
  "endpoint": "GET /api/users/:id"
}
```

### Health Check

```
GET /health
```

Returns service status, active subscriptions, circuit breaker state, and uptime.

## Scripts

```bash
npm run dev        # Start dev server (API + Vite HMR)
npm run build      # Build for production (migrations + client + server)
npm start          # Run production server
npm run db:generate # Generate Drizzle migrations
npm test           # Run tests
```

## License

MIT
