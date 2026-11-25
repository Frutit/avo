# Avo

Avo is a local first habits, tasks and timer app built with React Router, Cloudflare Workers, D1 and Dexie. It uses the Cloudflare CLI (`cf`) for development, builds, deployment and database operations.

## Local development

Use Node 26 and npm 11.20.0. Install dependencies, copy `.dev.vars.example` to `.dev.vars`, replace both local secrets, then initialize D1:

```sh
npm ci --ignore-scripts
npm run cf-typegen
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

The app is served at `http://localhost:5173`. The home screen stores guest data in Dexie and does not need D1. D1 backs Better Auth and account sync. Local email/password auth is disabled by default; OAuth needs provider credentials and callbacks configured for the local origin.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run db:check
npm run check:tasks
npm run build
```

`npm run build` uses `cf build` and includes the service worker in `.cloudflare/output/v1/`. The restored D1 database is declared in `cloudflare.config.ts`; local development and CI use simulated D1. Follow the [production runbook](docs/cloud/avo-cloudflare-production.md) to configure GitHub deployments and connect the domain.

## Data and runtime

- D1 schema and migrations are in `lib/db/d1-schema.ts` and `drizzle-d1/`.
- `/api/auth/*`, `/api/account/me` and `/api/account/data` use the Worker binding and secret environment. Account data remains isolated by the authenticated user ID.
- `lib/db/postgres-d1-export.ts` reads a consistent PostgreSQL snapshot. `lib/db/d1-import.ts` accepts only the explicit durable-table allowlist. These are migration utilities; no live Neon connection is configured by this branch.
- Guest data, timer/session history, recurring routine outcomes and activity events remain local in Dexie.
- OAuth tokens are omitted from the import. Existing sessions are not imported.

See [task 033](tasks/active/033-cloudflare-d1-migration.md) for migration evidence and remaining production work.
