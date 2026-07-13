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
| `TWILIO_ACCOUNT_SID`                    | Vercel                | Twilio account                                          |
| `TWILIO_AUTH_TOKEN`                     | Vercel                | SMS API + inbound webhook signature                     |
| `TWILIO_MESSAGING_SERVICE_SID`          | Vercel                | **Preferred** A2P sender pool (omit `From` when set)    |
| `TWILIO_FROM_NUMBER`                    | Vercel                | Fallback if Messaging Service SID is not set            |
| `NEXT_PUBLIC_PRIVACY_POLICY_URL`        | Vercel                | Live Privacy Policy on torontomoto.com (Wix)            |
| `NEXT_PUBLIC_TERMS_URL`                 | Vercel                | Live Terms / SMS program terms on torontomoto.com       |
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
- [ ] Twilio TrustHub: Business Profile approved → Brand → Campaign → Messaging Service (see §8)
- [ ] `TWILIO_*` set on Vercel; inbound + status webhook URLs match `NEXT_PUBLIC_APP_URL`
- [ ] Migration `037_customer_sms_opt_out` applied
- [ ] Migration `038_sms_consent` applied (dual consent + audit log)
- [ ] Wix Privacy Policy + Terms published from `docs/compliance/` drafts
- [ ] `NEXT_PUBLIC_PRIVACY_POLICY_URL` and `NEXT_PUBLIC_TERMS_URL` set on Vercel
- [ ] Public opt-in live at `https://service.torontomoto.com/sms` (disclosures + legal links)
- [ ] Twilio campaign submitted using `docs/compliance/twilio-verification-paste-pack.md`
- [ ] Messaging Service **Advanced Opt-Out** enabled
- [ ] `CRON_SECRET` set; Vercel cron uses Bearer auth (daily schedules for Hobby)
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

---

## 8. Twilio / TrustHub (CA-primary + occasional US)

**Strategy:** One Canadian local 10DLC (prefer GTA area code) in a Messaging Service, with US A2P Brand + Campaign attached so the same pool reaches CA daily and US when needed. Do **not** commit Bundle SID or Auth Token to git.

### Console steps

1. **Geo permissions** — Enable SMS to **Canada** and **United States**.
2. **Business Profile** — Must be approved in Trust Hub (already done when Twilio emails approval).
3. **A2P Brand** — Trust Hub → A2P. Prefer Low-Volume Standard (or Standard if volume will grow). Legal name + Canadian Business Number must match the approved profile.
4. **A2P Campaign** (after Brand approval) — include all four message-flow elements reviewers expect:
   - Use case: **Customer Care** / account notifications (transactional work-order messages, not marketing).
   - Description: Toronto Moto notifies customers about approvals, pickup readiness, contracts, and payment links for their service.
   - Opt-in method: phone collected at intake / Wix booking / in-app customer create (no pre-checked marketing box).
   - Frequency: e.g. “Up to several transactional msgs per active work order.”
   - Disclosure: “Message and data rates may apply.”
   - STOP / HELP language + privacy policy URL (public).
   - Sample messages: app templates (`approval_request`, `ready_for_pickup`, `contract_link`, `payment_reminder`) ending with `Reply STOP to opt out.`
   - Embedded links: **yes** (customer portal URLs).
5. **Number + Messaging Service**
   - Buy or assign a **Canadian local** 10DLC.
   - Create a Messaging Service; add the number to the sender pool; link the approved Campaign.
   - Enable **Advanced Opt-Out** + compliance toolkit.
6. **Webhooks** (Messaging Service preferred):
   - Incoming: `https://service.torontomoto.com/api/twilio/webhooks`
   - Status callbacks are also set per-send to `https://service.torontomoto.com/api/twilio/status`
   - Origin must match `NEXT_PUBLIC_APP_URL` exactly (signature verification is fail-closed).
7. **Record for Vercel (not git):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` (preferred). Optionally keep `TWILIO_FROM_NUMBER` as documentation of the pool number.

Brand approval is often fast; Campaign review can take **~10–15 days**. Treat **US** sends as blocked until the Campaign is approved and the number shows `REGISTERED`. CA traffic may work earlier depending on carrier filtering.

### SMS compliance publish sequence

1. **Publish Wix legal pages** — paste `docs/compliance/privacy-policy-wix.md` and `docs/compliance/sms-terms-wix.md` into torontomoto.com Privacy Policy and Terms.
2. **Set env on Vercel** — `NEXT_PUBLIC_PRIVACY_POLICY_URL=https://www.torontomoto.com/privacy-policy` and `NEXT_PUBLIC_TERMS_URL=https://www.torontomoto.com/terms`; redeploy.
3. **Verify `/sms` live** — open `https://service.torontomoto.com/sms`; confirm unchecked boxes, disclosures, Privacy/Terms links, and successful opt-in test.
4. **Submit campaign** — use `docs/compliance/twilio-verification-paste-pack.md` in Trust Hub / A2P Console (use cases: CUSTOMER_CARE, ACCOUNT_NOTIFICATIONS, MARKETING).
5. **Enable Advanced Opt-Out** on the Messaging Service before production SMS volume.

### App env

| Variable                       | Required  | Notes                                                  |
| ------------------------------ | --------- | ------------------------------------------------------ |
| `TWILIO_ACCOUNT_SID`           | Yes       |                                                        |
| `TWILIO_AUTH_TOKEN`            | Yes       | Also verifies `X-Twilio-Signature` on inbound + status |
| `TWILIO_MESSAGING_SERVICE_SID` | Preferred | When set, sends use `MessagingServiceSid` (no `From`)  |
| `TWILIO_FROM_NUMBER`           | Fallback  | Required only if Messaging Service SID is unset        |
| `NEXT_PUBLIC_APP_URL`          | Yes       | Used for signature URL + StatusCallback                |

### App behaviour (shipped)

- Prefer Messaging Service SID when sending; append STOP footer; E.164 normalize (`+1` for 10-digit NA).
- `customer.sms_opted_out_at` set on STOP keywords; cleared on START/UNSTOP (and YES when not an approval reply). Outbound SMS is blocked when opted out.
- Status callbacks update `communication_log.status` (`queued` / `sent` / `delivered` / `failed`).
- Work-order Messages, Square “Send for approval”, and billing Remind prefer SMS when phone is present and not opted out.

### Deploy + smoke

1. Apply migrations `037_customer_sms_opt_out.sql` and `038_sms_consent.sql`.
2. Set the Twilio env vars on Vercel (Production; Preview if you test SMS there), plus `NEXT_PUBLIC_PRIVACY_POLICY_URL` and `NEXT_PUBLIC_TERMS_URL` after Wix publish.
3. `vercel.json` crons are **daily** (`0 15 * * *` Parts Canada, `0 16 * * *` Wix contacts) so Hobby deploys succeed.
4. Redeploy so webhooks and secrets are live.
5. **CA:** From a work order, send an SMS template to a Canadian mobile; confirm delivery / status updates in `communication_log`.
6. **Inbound:** Reply `YES` / `APPROVE` on an approval request when a single job is waiting; confirm job updates. Reply `STOP` — carrier opt-out + `sms_opted_out_at` set.
7. **Webhook security:**
   - `NEXT_PUBLIC_APP_URL=https://service.torontomoto.com node scripts/smoke-twilio-webhook.mjs` → **401**
   - Unsigned `POST /api/twilio/status` → **401** (or **503** if Twilio still incomplete)
8. **US:** After Campaign approval + number `REGISTERED`, send one SMS to a US mobile.

**Vercel gap:** `NEXT_PUBLIC_APP_URL` and `TWILIO_ACCOUNT_SID` are set. You still must add (do not commit):

```bash
npx vercel env add TWILIO_AUTH_TOKEN production --sensitive --yes
npx vercel env add TWILIO_AUTH_TOKEN preview --sensitive --yes
# After Messaging Service exists in Console:
npx vercel env add TWILIO_MESSAGING_SERVICE_SID production --sensitive --yes
npx vercel env add TWILIO_MESSAGING_SERVICE_SID preview --sensitive --yes
```

Then `npx vercel --prod` and re-run the smoke script (expect **401**).

### CASL reminder

Transactional service messages still need consent / implied consent under CASL. Keep opt-out language on outbound SMS; do not use this channel for unsolicited marketing.
