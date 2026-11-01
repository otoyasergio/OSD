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
| `TWILIO_ACCOUNT_SID`                    | Vercel                | Twilio Voice/Video account                              |
| `TWILIO_AUTH_TOKEN`                     | Vercel                | Twilio Voice webhook signatures                         |
| `TWILIO_API_KEY_SID` / `*_SECRET`       | Vercel                | Twilio Voice/Video access tokens                        |
| `TWILIO_TWIML_APP_SID`                  | Vercel                | Twilio outbound Voice TwiML App                         |
| `WIX_API_KEY` / `WIX_SITE_ID`           | Vercel                | Contacts/Bookings plus Inbox read/manage                |
| `WIX_INBOX_SMS_ENABLED`                 | Vercel                | Exact `1` enables outbound Wix Inbox SMS                |
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

**Production branch is `main` only.** Never deploy `feature/*` (including
`feature/v1-implementation`) to https://service.torontomoto.com. Doing that
rolls the live site back to whatever that branch last contained.

1. GitHub default branch must be `main` (repo setting).
2. Vercel → Project → Settings → Environments → Production → Branch Tracking → `main`.
3. Connect the GitHub repo in Vercel (Login Connection) so pushes to `main` deploy production.
4. For CLI deploys use **only** `npm run deploy:production` (guards: on `main`, matches `origin/main`, clean tree). Do **not** run bare `vercel --prod` from a feature branch.
5. Set all env vars (Production + Preview as needed).
6. Confirm webhook URLs in Square / Twilio / Wix match `NEXT_PUBLIC_APP_URL`.
7. Smoke on **Safari Mac** and **Safari iPad**.
8. CI must be green: `npm run typecheck && npm run lint && npm test && npm run build`.

### Compute (Vercel Functions)

Repo (`vercel.json`) — these ship with the app:

- **Fluid compute** is on (`fluid: true`) so function instances are reused and concurrent shop requests share CPU instead of cold-starting a new lambda per click.
- Functions are pinned to **`pdx1`** (Portland / AWS `us-west-2`) to
  co-locate database-backed SSR and actions with the production Supabase
  project. Static assets remain globally served by Vercel's CDN.

Dashboard (cannot be set in `vercel.json` when Fluid is on):

- **Pro / Enterprise:** Vercel → Project → Settings → Functions → Function CPU → **Performance (4 GB / 2 vCPU)**. Use this for Control Center / dashboard SSR and heavy cron work. Do **not** add `functions.*.memory` in `vercel.json` — Fluid rejects it at build time.

Cron routes export `maxDuration = 300` in code and in `vercel.json` `functions` (Pro plan ceiling).

---

## 5. Pre-cutover checklist

- [ ] Every repository migration required by the release is applied and
      recorded on the production project
- [ ] Storage buckets present and private
- [ ] Owner `app_user` linked + assigned to a location
- [ ] Webhook signature keys configured; Wix secret set if bookings used
- [ ] Wix API key has Contacts read/manage, Bookings read, and Inbox read/manage
- [ ] 647-424-1088 remains in Wix; staff own all replies in Wix Inbox (see §8)
- [ ] Before SMS cutover, remove `TWILIO_MESSAGING_SERVICE_SID` and
      `TWILIO_FROM_NUMBER` from Vercel Production; retain all Twilio Voice/Video
      credentials
- [ ] Wix Inbox SMS canary passed before `WIX_INBOX_SMS_ENABLED=1` is set in Production
- [ ] Twilio Voice/Video variables are set; all Voice webhook URLs match `NEXT_PUBLIC_APP_URL`
- [ ] Migration `037_customer_sms_opt_out` applied
- [ ] `CRON_SECRET` set; Vercel cron uses Bearer auth (Parts Canada every 4 hours + Wix contacts every 4 minutes on **Pro**, both gated to 10:00–23:00 Toronto; weekly shop report at Saturday 00:00 and 01:00 UTC, sends only in the Friday 8:00 p.m. Toronto hour)
- [ ] Migration `20261031030000_weekly_shop_report_dedupe.sql` applied and the Toronto shop Gmail mailbox connected, so the Friday report to `info@torontomoto.com` can send once per week
- [ ] Vercel → Settings → Functions → Function CPU → **Performance (4 GB / 2 vCPU)**
- [ ] `npm run smoke:production` passes against https://service.torontomoto.com (set `CRON_SECRET` locally for bearer check)
- [ ] `GET /api/health` returns `{ ok: true }` with `integrations.supabase`, `integrations.wixSms`, and `integrations.twilioVoice` all `"ok"`
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
- **Billing / portal:** Square estimates/invoices, customer portal at `/c/[token]`, Wix Inbox SMS, and email are in scope for V2+.
- **Reports:** Owners/managers → Settings → Reports.
- **Work order numbers:** Per-location via `mint_work_order_number`.

---

## 7. Rollback / incident basics

1. Prefer **forward fixes** (new migration) over rewriting applied SQL.
2. App rollback generally uses a known-good deployment. For this Wix SMS
   release, do not restore an immutable pre-cutover deployment: disable Wix SMS
   and deploy current `main` as documented in the Wix operations runbook.
3. Auth lockout: Supabase Dashboard → Authentication password reset; ensure `app_user.status = 'active'`.
4. Compromised webhook: rotate secrets; see [`SECURITY.md`](../../../SECURITY.md).

---

## 8. Wix Inbox SMS and Twilio Voice/Video

### Customer SMS (Wix Inbox)

647-424-1088 stays in Wix. Do not port or move it without a new, explicit owner
decision. The app sends outbound SMS through Wix Inbox; staff read and answer
every reply in Wix Inbox. There is no app inbound-message webhook and no carrier
delivery callback.

1. Give the Wix API key Contacts read/manage, Bookings read, and Inbox
   read/manage permissions for the Toronto site.
2. Configure `WIX_API_KEY` and `WIX_SITE_ID` with
   `WIX_INBOX_SMS_ENABLED` empty.
3. Confirm health reports `wix: "ok"` and `wixSms: "missing"`.
4. Follow the Preview canary in
   [`docs/ops/wix-inbox-sms.md`](../../ops/wix-inbox-sms.md), including a
   blocked unsubscribed contact and a handset reply visible only in Wix Inbox.
5. After owner acceptance, set `WIX_INBOX_SMS_ENABLED=1` in Production,
   redeploy current `main`, and repeat one message.
6. Run `npm run smoke:production`; it requires `wixSms: "ok"` and independent
   `twilioVoice: "ok"` health.

Consent is checked against the current Wix Contact before every send. Do not
override an unsubscribed, missing-subscription, mismatched-phone, or invalid
deliverability result. A `sent` app log means Wix accepted the request; it does
not prove carrier delivery. Troubleshooting and flag-only rollback are in the
Wix operations runbook.

### Shop phone (Twilio Voice/Video)

Twilio is retained for Voice and Video. Required server values are
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`,
`TWILIO_API_KEY_SECRET`, and `TWILIO_TWIML_APP_SID`.

1. Set the TwiML App Voice request URL to
   `https://service.torontomoto.com/api/twilio/voice/outbound` (HTTP POST) and
   status callback to
   `https://service.torontomoto.com/api/twilio/voice/status`.
2. For each shop Voice number, set its webhook to
   `https://service.torontomoto.com/api/twilio/voice/inbound` and status
   callback to `https://service.torontomoto.com/api/twilio/voice/status`.
3. Keep `NEXT_PUBLIC_APP_URL=https://service.torontomoto.com` so Twilio
   signature URLs match exactly.
4. In **Settings → Locations**, set **Shop phone** to that Voice number's E.164.
5. Smoke unsigned `POST /api/twilio/voice/inbound`: expect **401**, or **503**
   when `TWILIO_AUTH_TOKEN` is absent. Logged-out
   `POST /api/calls/voice-token` and Video `POST /api/calls/token` must return
   **401**.
6. Run a controlled manual smoke after automated checks: place an inbound Voice
   call to the distinct Twilio Voice number, place an outbound Voice call from
   the browser, and complete a Video call between two authorized staff
   sessions. Confirm call status records close for both Voice directions.

No call recording or voicemail audio is enabled in v1. Missed inbound calls
still log and play the configured missed-call prompt.
