# Supabase and Vercel platform health

Operational runbook for **OTOMOTO TORONTO MOTO INC.**

Live app: <https://service.torontomoto.com>

## Architecture

- Vercel serves the Next.js application with Fluid Compute enabled.
- Vercel Functions run in `pdx1` (`us-west-2`) to co-locate application
  compute with the Supabase database.
- Supabase provides Postgres 17, Auth, Realtime, and private Storage.
- Production deploys come from `main` only via `npm run deploy:production`.

Static assets remain globally cached by Vercel. Keeping database-backed
functions close to Supabase avoids a cross-continent round trip on every
authenticated server render and action.

## Required Vercel environments

Configure values in the Vercel project, never in tracked `.env` files.

| Environment | Supabase target                           | Notes                          |
| ----------- | ----------------------------------------- | ------------------------------ |
| Production  | Production Supabase                       | `main` only                    |
| Preview     | Dedicated migrated non-production project | Never production customer data |
| Development | Local/disposable project                  | Pull with `vercel env pull`    |

Required core names:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`

Ask OTOMOTO additionally requires server-only `OPENAI_API_KEY`. Optional
`OTOMOTO_DIAGNOSTICS_*` settings must pass the same validation as production
generation. Keep Square, Twilio, Wix, Parts Canada, Resend, Sentry, and
`CRON_SECRET` scoped to the environments that actually use them.

Never expose `SUPABASE_SERVICE_ROLE_KEY` or `OPENAI_API_KEY` through a
`NEXT_PUBLIC_*` name.

## Verification

Public checks:

```bash
curl -i https://service.torontomoto.com/api/health
curl -i https://service.torontomoto.com/login
```

Expected:

- `/api/health` returns `200` with every configured production integration
  marked `ok`, `degraded: false`, and `region: "pdx1"` after the regional
  deployment ships.
- `/` redirects to `/login` with `private, no-store`.
- TLS is valid and HSTS is enabled.

After authenticating the correct Vercel `otoya` scope, also verify:

```bash
vercel env ls production
vercel env ls preview
vercel crons ls
vercel ls
```

Check names and scopes only; never print secret values. The two current cron
schedules require a Vercel Pro-or-higher project because Hobby cron jobs may
run only once per day.

For Supabase:

```bash
npx supabase migration list
npx supabase test db
npm run test:integration
node scripts/check-photo-schema.mjs
```

`check-photo-schema.mjs` is read-only: it uses the configured
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to fetch PostgREST
OpenAPI and confirm required photo columns/RPC exist. It never prints secrets.

Run those against an isolated or explicitly selected project. Review the
Supabase Security and Performance Advisors after every DDL change.

Production migration history contains timestamps from prior dashboard/MCP
applies that do not match every repository filename. Do not run
`supabase db push` blindly against production. Apply each reviewed new
migration once, in repository filename order, and record the remote migration
version returned by the approved production procedure.

## Release order

Safari photo / checkout evidence ships **queue-first, checkout-second**, and
only from `main`.

1. Apply and verify migrations on an isolated database (filename order:
   intake photo idempotency, checkout evidence gates, checkout review
   fixes, intake photo storage policies, 20261001121000 checkout photo
   insert ready gate, then 20261001121010 intake photo RPC checkout
   labels).
2. Regenerate and review TypeScript types against non-production.
3. Configure a Preview deployment with non-production Supabase and provider
   credentials. Leave `PHOTO_UPLOAD_QUEUE_ENABLED` and
   `CHECKOUT_EVIDENCE_ENABLED` unset (volatile queue, ungated checkout).
4. Run pgTAP, integration tests, stateful Safari E2E, the Ask OTOMOTO
   acceptance worksheet, and `npm run photos:reconcile` as a **read-only**
   reconciliation check.
5. Enable `PHOTO_UPLOAD_QUEUE_ENABLED=1` on Preview only. Walk
   [docs/ops/safari-photo-acceptance.md](safari-photo-acceptance.md) on
   current shop iPad (portrait and landscape), iPhone Safari, and macOS
   Safari. Linux Playwright WebKit is not device Safari.
6. After durable-queue signoff, enable `CHECKOUT_EVIDENCE_ENABLED=1` on
   Preview. Re-run Ready/Complete block and owner/manager override rows
   from the same runbook.
7. Obtain technician and service-advisor signoff.
8. Confirm with the shop owner whether signed Wix booking webhooks should
   automatically create work orders. The platform-hardening migration repairs
   that previously blocked path.
9. During a separately approved production rollout, apply verified production
   migrations first. Then set `PHOTO_UPLOAD_QUEUE_ENABLED=1` (durable queue
   first). Only after shop-device acceptance, set
   `CHECKOUT_EVIDENCE_ENABLED=1`.
10. Deploy current `main` with `npm run deploy:production`. That script runs
    the `scripts/guard-prod-deploy.mjs` main-branch guard first, then the read-only `scripts/check-photo-schema.mjs`
    gate (PostgREST OpenAPI for `intake_photo`, `work_order`, and
    `/rpc/create_intake_photo_with_event`) before Vercel. Never deploy
    production from a feature branch.
11. Re-run health, logs, advisors, smoke checks, and a read-only
    reconciliation report.

Isolated CI (`npm run test:integration` plus stateful Safari) is required.
Those jobs export `TEST_SUPABASE_*` from the disposable stack and **failures
block** the pull request. Local developers may skip them when
`TEST_SUPABASE_URL` is unset. Keep the isolated integration/Safari job
required so a configured failure cannot merge.

Do not apply production migrations or deploy production from a feature branch.

## Dashboard-only controls

These cannot be changed safely from repository code:

- Grant the deployment operator access to the Vercel `otoya` project scope.
- Confirm that the Vercel project is Pro or higher for the four-minute and
  four-hour cron schedules.
- Enable Supabase Auth leaked-password protection when available on the
  project's plan.
- Change Supabase Auth database connections from a fixed count to percentage
  allocation before increasing the database instance size.
- Confirm backups/PITR and owner recovery before production migrations.

## Current intentional exceptions

- `square_webhook_event` is service-role-only. Browser access is explicitly
  denied by RLS.
- RLS helper functions that return the current user, role, membership, or
  participant status remain callable by authenticated users because policies
  depend on them. They return only caller-scoped booleans/identifiers.
- Missing-FK and unused-index advisor entries are reviewed against real query
  paths; indexes are not added or removed solely to silence an advisor.
- The `pg_trgm` extension remains in `public` until relocation is verified on
  a Supabase-hosted non-production branch owned by the same platform roles.
