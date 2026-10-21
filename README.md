# Tradelog

The shared IBKR trade journal for Santosh (`anilsub02`) and Anil (`anilsub01`).

Every execution from both sub-accounts is grouped into trades and shown day by day. The trader writes why they took each trade; the other person reviews it. Each trade is rated against a shared rulebook. A trade with a lesson stays open until both people sign off. A dashboard shows combined and per-person P&L, cash, account value and positions for the day, week, month and year, and the Analytics page shows where the money leaks.

Only two Google accounts can sign in. Everyone else is turned away.

Full specification: [`docs/Tradelog_Project_Docs.docx`](docs/Tradelog_Project_Docs.docx) (PRD, TRD, App Flow, UI/UX brief, Backend Schema, Implementation Plan, Project Plan).

## Quick start: run it on your computer

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) and a Google OAuth client (5 minutes, steps under "Google sign-in" below; register `http://localhost:8080/auth/google/callback` as the redirect URI).

```
./scripts/local-up.sh            # macOS, Linux, or Git Bash on Windows
.\scripts\local-up.ps1           # Windows PowerShell
```

The first run creates `.env` with generated secrets, asks for the Google client ID and secret, builds everything and waits until it's up. Then open **http://localhost:8080** and sign in with `santosh.krishna0909@gmail.com` or `mailanilkumar@gmail.com`. No other Google account gets in.

- `--demo` (`-Demo` on Windows) also loads a month of made-up sample trades so every page has something to show.
- `--reset` (`-Reset`) stops everything and wipes the local database. Do this before importing your real trades if you loaded the sample.
- Real trades: Import page > drop an IBKR Flex file, or add the Flex token and query IDs to `.env` and run `docker compose up -d` again so the worker syncs on schedule.

## Stack

| Layer | Choice |
| --- | --- |
| Front end | React 18, TypeScript, Vite, TanStack Query, React Router, Recharts |
| API | Node.js 20, TypeScript, Express, Zod, Passport (Google OAuth 2.0) |
| Database | PostgreSQL 16 (plain SQL migrations) |
| Jobs | node-cron worker calling the IBKR Flex Web Service |
| Shared logic | `@tradelog/core`: Flex parser, trade builder, scoring, analytics (unit tested with Vitest) |
| Deploy | Docker Compose: Postgres, API, worker, nginx serving the web app and proxying `/api` and `/auth` |

## Repository layout

```
packages/core      Trade engine shared by API and web (no I/O)
  src/flex         IBKR Flex parser: Activity + Trade Confirmation, XML + CSV
  src/trades       Fills -> trades, cash and position after each fill, scoring, P&L bands
  src/analytics    Summary stats, breakdowns, equity curve, leak detection
  test             Unit tests and Flex fixtures
apps/api           Express API, Google auth, IBKR sync worker
  migrations       SQL migrations (001 schema, 002 starter rules)
  scripts          migrate.ts, smoke.ts (end-to-end), seed-demo.ts (dev data)
apps/web           React app
docs               Project docs and IBKR setup
```

## First-time setup

### 1. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, then APIs & Services > OAuth consent screen. Choose **External**, publishing status **Testing**, and add both Google addresses as test users. Testing mode is a second lock: Google itself refuses anyone not on that list.
2. Credentials > Create credentials > OAuth client ID > Web application.
   - Authorized JavaScript origins: `http://localhost:8080` (local Docker), `http://localhost:5173` (dev servers), and later your droplet's `https://` address
   - Authorized redirect URIs: the same origins followed by `/auth/google/callback`
3. Put the client ID and secret in `.env`, and list the two people:

```
ALLOWED_USERS=santosh.krishna0909@gmail.com:anilsub02,mailanilkumar@gmail.com:anilsub01
```

The API checks this list at sign-in and again on every request, so removing an address revokes access immediately.

### 2. IBKR Flex queries

Follow [`docs/ibkr-flex-setup.md`](docs/ibkr-flex-setup.md). Until the token is in place, use the Import page to drop Flex files.

### 3. Environment

```
cp .env.example .env    # then fill it in
```

## Running locally

Requires Node 20+ and PostgreSQL 16.

```
npm install
createdb tradelog                 # or point DATABASE_URL at any empty database
npm run migrate
npm run dev:api                   # API on :4000
npm run dev:web                   # web on :5173, proxies /api and /auth to :4000
npm run worker                    # optional: scheduled IBKR sync
```

Open http://localhost:5173 and sign in with Google.

To look around with sample data instead of real fills (development database only):

```
cd apps/api && npx tsx scripts/seed-demo.ts ../../packages/core/test/fixtures/activity.xml
```

## Testing

```
npm test                          # core unit tests
npm run typecheck                 # all three packages
DATABASE_URL=postgres://.../tradelog_test npm run smoke --workspace @tradelog/api
```

`smoke` runs 29 end-to-end checks against a throwaway database: the sign-in gate, who may write what, joint lesson sign-off, imports and re-imports, the next-morning P&L upgrade, removal of erroneous trades, the dashboard and analytics. It writes test data; never point it at production.

## Deploying to DigitalOcean

Every push to `main` runs CI (typecheck, unit tests, the end-to-end smoke test on Postgres, web build). When CI passes, the Deploy workflow builds Docker images, pushes them to GitHub Container Registry, and rolls them out to the droplet over SSH, with an automatic rollback if the new version fails its health check. Caddy on the droplet handles HTTPS.

One-time setup, step by step: [`docs/deploy-digitalocean.md`](docs/deploy-digitalocean.md).

| File | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Tests on every pull request and push |
| `.github/workflows/deploy.yml` | Build, push, deploy, health check; manual run with a tag rolls back |
| `deploy/droplet-setup.sh` | Prepares a fresh Ubuntu droplet (Docker, deploy user, firewall, backups) |
| `deploy/docker-compose.prod.yml`, `deploy/Caddyfile` | Production stack with HTTPS |
| `deploy/remote-deploy.sh` | Runs on the droplet during each deploy |
| `deploy/.env.production.example` | Template for `/opt/tradelog/.env` on the droplet |

## How the numbers are built

- A **trade** is every fill in one contract in one account from when the position leaves zero until it returns to zero. Scale-outs and the runner stay one trade.
- **Realized P&L** uses IBKR's `fifoPnlRealized` from the Activity report. Before that report arrives, a complete round trip uses the sum of net cash; carry-ins wait for the Activity report.
- **Cash after** each fill = the day's opening cash (IBKR Cash Report, or typed in) + cumulative net cash that day. A missing opening carries forward the prior day's close.
- **Account value** is IBKR's NAV from the Activity report. **Open position** is open contracts and cost basis from the fills, with IBKR's market value when the report has it.
- **Removed** (erroneous) trades are excluded from every figure but never deleted, and can be put back.
