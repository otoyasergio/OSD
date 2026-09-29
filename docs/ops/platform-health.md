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

| Environment | Supabase target | Notes |
| --- | --- | --- |
| Production | Production Supabase | `main` only |
| Preview | Dedicated migrated non-production project | Never production customer data |
| Development | Local/disposable project | Pull with `vercel env pull` |

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
  marked `ok`.
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
```

Run those against an isolated or explicitly selected project. Review the
Supabase Security and Performance Advisors after every DDL change.

## Release order

1. Apply and verify migrations on an isolated database.
2. Regenerate and review TypeScript types against non-production.
3. Configure a Preview deployment with non-production Supabase and provider
   credentials.
4. Run pgTAP, integration tests, stateful Safari E2E, and the Ask OTOMOTO
   acceptance worksheet.
5. Obtain technician and service-advisor signoff.
6. During a separately approved production rollout, apply verified production
   migrations first.
7. Deploy current `main` with `npm run deploy:production`.
8. Re-run health, logs, advisors, and smoke checks.

Do not apply production migrations or deploy production from a feature branch.

## Dashboard-only controls

These cannot be changed safely from repository code:

- Grant the deployment operator access to the Vercel `otoya` project scope.
- Confirm that the Vercel project is Pro or higher for the four-minute and
  four-hour cron schedules.
- Enable Supabase Auth leaked-password protection.
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
