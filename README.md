# OTOMOTO Workshop Management App

Workshop management for OTOMOTO service operations—customers, bikes, location-scoped work orders, inspections, recommendations, parts, QC, pickup, Square billing, customer portal, and shop reports.

See [`SECURITY.md`](./SECURITY.md) for webhook auth and secrets, and [`docs/superpowers/acceptance/production-checklist.md`](./docs/superpowers/acceptance/production-checklist.md) for go-live.

## Target platforms

Primary target is **Safari on Mac and iPad**. Layout and interactions should be tested on those browsers. Safari on iPhone should remain usable but is secondary.

## Getting started

You need a **live Supabase project**. Do not invent credentials; copy them from the Supabase dashboard.

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open the project's **Connect** dialog and note:
   - Project URL
   - Publishable (`sb_publishable_...`) key; the legacy `anon` key remains a fallback
   - `service_role` key (server-only; never expose in the browser)

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in `.env.local` from [`.env.local.example`](./.env.local.example) (Supabase, Square, Twilio, Wix, cron, Sentry, Parts Canada).

Supabase Auth uses cookie-backed SSR sessions. `proxy.ts` verifies/refreshes the
session and protects every app page except `/login`, customer portal links under
`/c/*`, and API handlers. The `(app)` layout then requires an active `app_user`
record and assigned location before rendering staff tools.

### 3. Apply migrations

Migrations live in `supabase/migrations/` (`001`–`034`, with 010/011 reserved). Apply **in numeric order**:

```bash
npx supabase link
npx supabase db push
```

Or paste each file in the Supabase SQL Editor in order.

**Authorization note:** Role checks in `lib/permissions` (server actions) are the source of truth. RLS is defense in depth (location-scoped for WO tables as of `034`). Full matrix: [`docs/superpowers/acceptance/rls-audit.md`](./docs/superpowers/acceptance/rls-audit.md).

### 4. Create Auth users and bootstrap data

1. In Supabase Dashboard → **Authentication → Users**, create the demo Auth users below (email + password, confirmed). Copy each user’s UUID (`auth.users.id`).
2. In the SQL Editor, run `supabase/seed/dev_bootstrap.sql` (creates Toronto / `TOR` + `work_order_sequence`).
3. Uncomment and edit the Auth → `app_user` → `user_location` block at the bottom of that file (replace each `<…_AUTH_USER_UUID>`), then run it.
4. Optional: uncomment the second location block in the same file for multi-location / WO-number acceptance tests.
5. Enable **leaked password protection** in Auth → Password security before production.

**Demo staff accounts** (dev / acceptance only — **change passwords after first login**):

| Role            | Email                   | Temp password  |
| --------------- | ----------------------- | -------------- |
| owner           | `owner@otomoto.local`   | `Otomoto2026!` |
| manager         | `manager@otomoto.local` | `Otomoto2026!` |
| service_advisor | `advisor@otomoto.local` | `Otomoto2026!` |
| technician      | `tech@otomoto.local`    | `Otomoto2026!` |

Do not commit `service_role` keys.

### 5. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with one of the demo accounts above.

### 6. Safari notes

- Prefer **Safari on Mac** for front-office flows and **Safari on iPad** for technician / floor flows.
- Confirm login, location switcher, create work order (six required intake photos: front, rear, left, right, VIN, dash/odometer), inspection auto-save, extra photo upload from Photos tab / camera roll, approval, parts order block, QC, and complete.
- If cookies or auth redirects misbehave, confirm `.env.local` URL matches the project and that you are not mixing `localhost` with a different host.

### 7. Acceptance (Task 35)

Walk the checklist in [`docs/superpowers/acceptance/v1-checklist.md`](./docs/superpowers/acceptance/v1-checklist.md) (build-sheet Tests 1–17 plus design extras). Task 35 is not done until that live pass succeeds.

### Performance baseline

Dashboard board load uses one nested `work_order` query (jobs, recommendations, photos, inspection) scoped to the active location and non-terminal statuses, plus a parallel technician membership query. Target: **under 2s** for ~200 active work orders on a warm Supabase project after migrations `013_performance_indexes.sql`. Re-check with Safari Network after seeding volume.

## Tests

```bash
npm test                 # unit (Vitest)
npm run test:coverage    # coverage thresholds on core libs
npm run test:e2e         # Playwright smoke (login, middleware, webhooks)
npm run typecheck
npm run lint
```

Watch mode: `npm run test:watch`

## Build

```bash
npm run build            # webpack (Turbopack has a Zod datetime bundling bug)
```

## Production

See the production runbook: [`docs/superpowers/acceptance/production-checklist.md`](./docs/superpowers/acceptance/production-checklist.md) (env vars, migration order, Vercel/Safari, backups, owner recovery, advisors).

## Documentation

- Security: [`SECURITY.md`](./SECURITY.md)
- Changelog: [`CHANGELOG.md`](./CHANGELOG.md)
- Design: [`docs/superpowers/specs/`](./docs/superpowers/specs/)
- Implementation plan: [`docs/superpowers/plans/`](./docs/superpowers/plans/)
- V1 acceptance checklist: [`docs/superpowers/acceptance/v1-checklist.md`](./docs/superpowers/acceptance/v1-checklist.md)
- RLS audit: [`docs/superpowers/acceptance/rls-audit.md`](./docs/superpowers/acceptance/rls-audit.md)
- Production checklist: [`docs/superpowers/acceptance/production-checklist.md`](./docs/superpowers/acceptance/production-checklist.md)
