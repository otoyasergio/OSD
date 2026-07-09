# Production checklist & runbook

**App:** OTOMOTO Workshop Management  
**Stack:** Next.js App Router + Supabase (Auth, Postgres, Storage)  
**Primary clients:** Safari on Mac (front office) and Safari on iPad (technician / inspection)

Use this document for go-live and for onboarding a new engineer from an empty clone. Day-to-day local setup remains in the root [`README.md`](../../../README.md).

---

## 1. Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + `.env.local` | Publishable / anon key (browser + SSR cookie client) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** if used | Never expose to the browser; prefer not shipping it in V1 app code unless a future admin script needs it |

Copy from [`.env.local.example`](../../../.env.local.example). Do not commit `.env.local`.

Auth cookies are set by `@supabase/ssr` in middleware and the server client. Production must use **HTTPS**. Site URL and redirect allow-list in Supabase Auth must include the production origin (e.g. `https://your-app.vercel.app`).

---

## 2. Migration order

Apply **in numeric order**. Do not skip files.

| Order | File | Notes |
|------:|------|-------|
| 1 | `001_initial_schema.sql` | Core tables + base indexes |
| 2 | `002_locations_and_wo_numbers.sql` | Locations, WO numbers |
| 3 | `003_audit_log.sql` | Global audit log |
| 4 | `004_seed_services.sql` | Service catalogue seed |
| 5 | `005_seed_inspection_template.sql` | Inspection template seed |
| 6 | `006_rls_policies.sql` | RLS + `intake-photos` bucket |
| 7 | `007_mint_work_order_number.sql` | WO number RPC |
| 8 | `008_job_time_and_service_categories.sql` | Job `started_at`, service categories |
| 9 | `009_user_preferences.sql` | Saved views / board prefs |
| 10 | `012_rls_hardening.sql` | SECURITY DEFINER grants, owner `app_user` writes, audit append-only |
| 11 | `013_performance_indexes.sql` | Operational / partial indexes |

> Numbers **010** / **011** are reserved in the V2 plan for optional time clock / fleet tags (not shipped).

**CLI:** `npx supabase link` then `npx supabase db push`  
**Dashboard:** SQL Editor — paste each file in order.

After migrations, confirm Storage bucket **`intake-photos`** exists (private, 10 MB, image MIME types) — created by `006`.

---

## 3. Seed strategy

| Environment | Strategy |
|-------------|----------|
| **Dev / staging** | Run `supabase/seed/dev_bootstrap.sql` for Toronto (`TOR`) + sequence; link Auth user → `app_user` → `user_location` as documented in the seed file. |
| **Production** | Do **not** run full dev seed. Create real locations via Settings (owner) or a controlled SQL insert. Create the first **owner** Auth user, then insert matching `app_user` + `user_location` (same pattern as the commented block in `dev_bootstrap.sql`). Seed services/template come from migrations `004`/`005` only. |

---

## 4. Hosting (Vercel) + Safari

1. Connect the GitHub repo; deploy branch `main` (or your release branch).
2. Set env vars in the Vercel project (Production + Preview as needed).
3. Supabase Auth → **URL configuration**: Site URL = production URL; add redirect URLs for login callback if required by your Auth settings.
4. Smoke on **Safari Mac**: login, location switcher, dashboard board, create WO, search.
5. Smoke on **Safari iPad**: technician page, fullscreen inspection, photo upload from Photos, job start/complete.
6. If auth cookies fail: confirm URL scheme/host match Supabase allow-list; avoid mixing `localhost` and LAN IP for the same session.

---

## 5. Pre-cutover checklist

- [ ] Migrations `001`–`009`, `012`, `013` applied on the production project
- [ ] `intake-photos` bucket present and private
- [ ] At least one **owner** `app_user` linked to Auth + assigned to a location
- [ ] Second location (if multi-shop) created; staff assigned via Settings → Locations / Users
- [ ] `npm test` and `npm run build` green on the release commit
- [ ] V1 acceptance walkthrough started or scheduled ([`v1-checklist.md`](./v1-checklist.md)) — Safari Mac/iPad
- [ ] Supabase **security advisors** reviewed ([`rls-audit.md`](./rls-audit.md)); enable **leaked password protection** in Auth
- [ ] Supabase **performance advisors** reviewed; unused-index INFO noise expected on empty DBs
- [ ] Backups: confirm Supabase PITR / daily backups plan for the project tier
- [ ] Owner recovery: document who holds the owner Auth email + org access to Supabase + Vercel
- [ ] Monitoring: Dashboard → Advisors weekly for first month; watch Auth failed logins and Storage errors

---

## 6. Operational notes

- **Authorization:** `lib/permissions` + services are the source of truth; RLS is defense in depth (see RLS audit).
- **Audit log:** Owner-only UI at Settings → Audit; append-only at DB.
- **Work order numbers:** Per-location via `mint_work_order_number`; never hand-edit `work_order_sequence` under load.
- **No invoicing / portal** in this product — external invoice # is a thin link field only.

---

## 7. Rollback / incident basics

1. Prefer **forward fixes** (new migration) over rewriting applied SQL.
2. App rollback: redeploy previous Vercel deployment.
3. If Auth is locked out: use Supabase Dashboard → Authentication to reset the owner password; ensure `app_user.status = 'active'`.
4. Storage: intake photos are keyed by work order path; do not make the bucket public.
