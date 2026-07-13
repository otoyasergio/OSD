# Production checklist & runbook

**App:** OTOMOTO Workshop Management  
**Stack:** Next.js App Router + Supabase (Auth, Postgres, Storage) + Vercel  
**Primary clients:** Safari on Mac (front office) and Safari on iPad (technician / inspection)

Use this document for go-live and for onboarding a new engineer from an empty clone. Day-to-day local setup remains in the root [`README.md`](../../../README.md). Security details: [`SECURITY.md`](../../../SECURITY.md).

---

## 1. Environment variables

Copy from [`.env.local.example`](../../../.env.local.example). Do not commit `.env.local`.

| Variable                                | Where                 | Purpose                                                 |
| --------------------------------------- | --------------------- | ------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`              | Vercel + `.env.local` | Supabase project URL                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`         | Vercel + `.env.local` | Publishable / anon key                                  |
| `SUPABASE_SERVICE_ROLE_KEY`             | **Server only**       | Portal, webhooks, cron (bypasses RLS)                   |
| `NEXT_PUBLIC_APP_URL`                   | Vercel                | Exact public origin for magic links + webhook HMAC URLs |
| `SQUARE_*`                              | Vercel                | Billing + webhook signature key                         |
| `TWILIO_*`                              | Vercel                | SMS + inbound webhook auth                              |
| `WIX_WEBHOOK_SECRET`                    | Vercel                | **Required** if Wix bookings enabled (fail-closed)      |
| `CRON_SECRET`                           | Vercel                | Bearer for Parts Canada cron                            |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Vercel                | Optional error tracking                                 |

Auth cookies are set by `@supabase/ssr`. Production must use **HTTPS**. Site URL and redirect allow-list in Supabase Auth must include the production origin.

---

## 2. Migration order

Apply **in numeric order**. Do not skip files. Current tree includes `001`–`009`, `012`–`034` (gaps at 010/011 reserved).

Notable later migrations:

| File                                   | Notes                                             |
| -------------------------------------- | ------------------------------------------------- |
| `018_parts_canada_catalog.sql`         | Parts Canada sync tables                          |
| `019_square_expansion.sql`             | Contracts, portal tokens, Square columns, fitment |
| `022_time_clock.sql` / `032_*`         | Time clock + manager corrections                  |
| `023_work_order_billing_lifecycle.sql` | Billing stages                                    |
| `031_customer_documents.sql` / `033_*` | Customer documents + RLS                          |
| `034_location_scoped_rls.sql`          | Location-scoped RLS on WO-related tables          |

**CLI:** `npx supabase link` then `npx supabase db push`

After migrations, confirm Storage buckets: `intake-photos`, `contract-signatures`, `customer-documents` (private).

---

## 3. Seed strategy

| Environment       | Strategy                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| **Dev / staging** | Run `supabase/seed/dev_bootstrap.sql`; link Auth → `app_user` → `user_location`                  |
| **Production**    | Do **not** run full dev seed. Create real locations; first owner Auth user + matching `app_user` |

---

## 4. Hosting (Vercel) + Safari

1. Connect the GitHub repo; deploy branch `main`.
2. Set all env vars (Production + Preview as needed).
3. Confirm webhook URLs in Square / Twilio / Wix match `NEXT_PUBLIC_APP_URL`.
4. Smoke on **Safari Mac** and **Safari iPad**.
5. CI must be green: `npm run typecheck && npm run lint && npm test && npm run build`.

---

## 5. Pre-cutover checklist

- [ ] Migrations through `034` applied on the production project
- [ ] Storage buckets present and private
- [ ] Owner `app_user` linked + assigned to a location
- [ ] Webhook signature keys configured; Wix secret set if bookings used
- [ ] `CRON_SECRET` set; Vercel cron uses Bearer auth
- [ ] `npm test` and `npm run build` green
- [ ] Playwright smoke (`npm run test:e2e`) against staging when available
- [ ] Supabase **leaked password protection** enabled
- [ ] Supabase security + performance advisors reviewed ([`rls-audit.md`](./rls-audit.md))
- [ ] Sentry DSN set (recommended) or log-drain alerts on webhook/cron failures
- [ ] Backups / PITR confirmed for the Supabase tier
- [ ] Owner recovery contacts documented

---

## 6. Operational notes

- **Authorization:** `lib/permissions` + services are the source of truth; RLS is defense in depth (location-scoped for WO tables as of `034`).
- **Audit log:** Owner-only UI at Settings → Audit.
- **Billing / portal:** Square estimates/invoices, customer portal at `/c/[token]`, Twilio/Resend messaging are in scope for V2+.
- **Reports:** Owners/managers → Settings → Reports.
- **Work order numbers:** Per-location via `mint_work_order_number`.

---

## 7. Rollback / incident basics

1. Prefer **forward fixes** (new migration) over rewriting applied SQL.
2. App rollback: redeploy previous Vercel deployment.
3. Auth lockout: Supabase Dashboard → Authentication password reset; ensure `app_user.status = 'active'`.
4. Compromised webhook: rotate secrets; see [`SECURITY.md`](../../../SECURITY.md).
