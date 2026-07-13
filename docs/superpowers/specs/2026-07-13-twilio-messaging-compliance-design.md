# Twilio messaging compliance (toll-free / A2P ready)

**Date:** 2026-07-13  
**Status:** Approved design — pending implementation plan  
**Related:** Existing Twilio send/status/inbound stack; `docs/superpowers/acceptance/production-checklist.md` §8

## Goal

Ship the app + docs surfaces Twilio reviewers need so Toronto Moto can approve messaging (A2P 10DLC and/or toll-free verification): public SMS opt-in, dual consent (transactional + marketing), HELP/STOP automation, Privacy/Terms content for the main site, and a Console paste pack — without freezing current transactional SMS for legacy customers.

## Decisions (locked)

| Topic                | Choice                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Scope                | Full stack: public `/sms`, staff + portal consent, HELP replies, verification paste pack |
| Programs             | Transactional/customer care **and** marketing (separate consent)                         |
| Opt-in surfaces      | Public page + staff CustomerForm + customer portal                                       |
| Legal hosting        | Privacy + Terms on `torontomoto.com` (Wix); repo provides SMS-ready drafts to paste      |
| HELP contact         | Website only (`torontomoto.com`)                                                         |
| Legacy customers     | Soft rollout — keep current transactional sends until a consent UI touches the customer  |
| Architecture         | Customer consent flags **plus** append-only `sms_consent_event` audit log                |
| Public `/sms` layout | Standalone signup: phone + two unchecked checkboxes + full CTA disclosures               |

## Out of scope

- Editing the live Wix site from this repo
- Buying/registering Twilio numbers or submitting Console forms (docs guide only)
- Marketing campaign scheduler / blast UI (consent + send gate only; marketing templates/samples for verification)
- Changing the drop-off service agreement (separate from SMS program Terms)

## Architecture

```
Public /sms ─┐
Staff form  ─┼─► update customer flags + insert sms_consent_event
Portal      ─┘         │
                       ▼
              sendWorkOrderMessage / marketing sends
                       │
         soft: legacy transactional OK if both consent ats null
         marketing: requires sms_marketing_consent_at
         STOP: sms_opted_out_at blocks all
                       ▼
                   Twilio SMS
                       │
         inbound HELP / STOP / START (extend webhooks)
```

Legal URLs (env) point at published `torontomoto.com` pages. App `/sms` and CTAs link to those URLs.

## Data model

### `customer` (extend)

| Column                         | Type             | Notes                                                           |
| ------------------------------ | ---------------- | --------------------------------------------------------------- |
| `sms_opted_out_at`             | timestamptz      | Already exists                                                  |
| `sms_transactional_consent_at` | timestamptz null | Service/work-order texts                                        |
| `sms_marketing_consent_at`     | timestamptz null | Promos/offers                                                   |
| `sms_consent_source`           | text null        | Last source: `web_form` \| `staff` \| `portal` \| `inbound_sms` |

### `sms_consent_event` (new, append-only)

| Column          | Type        | Notes                                              |
| --------------- | ----------- | -------------------------------------------------- |
| `id`            | uuid PK     |                                                    |
| `customer_id`   | uuid FK     |                                                    |
| `program`       | text        | `transactional` \| `marketing` \| `all`            |
| `action`        | text        | `opt_in` \| `opt_out`                              |
| `method`        | text        | `web_form` \| `staff` \| `portal` \| `inbound_sms` |
| `source_path`   | text null   | e.g. `/sms`, portal path, `staff:customer_form`    |
| `actor_user_id` | uuid null   | Staff user when applicable                         |
| `created_at`    | timestamptz |                                                    |
| `notes`         | text null   | Optional                                           |

RLS: staff roles that can manage customers can read/insert; no public client writes — public `/sms` uses a server action / route with service role or validated insert path consistent with existing public patterns.

### Enforcement rules

1. **Opt-out:** If `sms_opted_out_at` is set → block all outbound SMS (existing behavior).
2. **Marketing:** Require `sms_marketing_consent_at` and not opted out. Never treat transactional consent as marketing consent.
3. **Transactional soft rollout:**
   - Allow if not opted out **and** (`sms_transactional_consent_at` is set **OR** both consent timestamps are still null).
   - Once any consent UI writes either consent timestamp (or an explicit “declined / left unchecked on save” policy — see below), that customer leaves legacy mode: transactional requires `sms_transactional_consent_at`.
4. **Staff/portal save semantics:** Checkboxes unchecked by default. Saving with phone:
   - Checked box → set corresponding consent_at + audit `opt_in`.
   - Unchecked after previously consented → clear consent_at + audit `opt_out` for that program (does not set global STOP unless they use STOP keyword).
   - First save through new UI with both unchecked → set a sentinel so soft-rollout ends: e.g. write `sms_transactional_consent_at` only when checked; for “touched” detection use `sms_consent_source` non-null **or** existence of any `sms_consent_event`. Prefer: any insert into `sms_consent_event` OR non-null `sms_consent_source` ends legacy allow. On first open/save of new UI without opt-in, set `sms_consent_source` to the method without setting consent ats (and optionally log `opt_out` / `declined` — **decision: set `sms_consent_source` on first consent-UI save even if both boxes unchecked, without granting consent**).
5. **START / UNSTOP:** Clears `sms_opted_out_at` only; does not grant marketing or transactional consent flags.
6. **Welcome SMS:** On new opt-in via web/portal/staff (transition from no consent → consented for at least one program), send confirmation including brand, frequency, rates, HELP, STOP.

## Public `/sms` page

- Route: public (middleware must not require auth), e.g. `app/sms/page.tsx`.
- Layout A: brand “Toronto Moto”, phone field, two independent unchecked checkboxes (service texts vs promotional offers), adjacent disclosure (business name, message types, frequency varies, message and data rates may apply, Reply HELP / STOP, links to Privacy + Terms), submit CTA.
- Consent optional relative to other shop services (standalone form = purpose is SMS enrollment).
- At least one program checkbox required to submit.
- On success: upsert/find customer by phone, set flags, write events, send welcome SMS.
- Links: `NEXT_PUBLIC_PRIVACY_POLICY_URL`, `NEXT_PUBLIC_TERMS_URL`.

## Staff UI

- `CustomerForm`: next to phone — two unchecked SMS consent checkboxes + short disclosure + Privacy/Terms links.
- Completing customer create/edit must not require SMS consent.
- Persist via existing customer save path + consent helper that updates flags and events.

## Portal UI

- `/c/[token]`: SMS preferences section with the same two consents + disclosures.
- Optional; customer can use portal without changing SMS prefs.
- Server action scoped to portal token’s customer.

## Messaging / keywords

Extend `handleInboundSms` / communications service:

| Keywords                                            | Behavior                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, HALT | Set `sms_opted_out_at`, audit `opt_out` program `all`, TwiML/reply: unsubscribed confirmation + visit torontomoto.com for help |
| HELP, INFO, SUPPORT                                 | Reply: Toronto Moto — for help visit torontomoto.com; frequency varies; msg & data rates may apply; Reply STOP to cancel       |
| START, UNSTOP                                       | Clear opt-out; no consent grants                                                                                               |
| YES / NO                                            | Existing approval flow unchanged when waiting_for_approval                                                                     |

Outbound templates keep `Reply STOP to opt out.` footer. Marketing sample/template(s) only send when marketing consent is present.

### Sample messages (verification pack)

- **CUSTOMER_CARE:** `Toronto Moto: Hi [Name], jobs on WO-[Number] need your approval. Review: https://service.torontomoto.com/c/[token]. Reply STOP to opt out.`
- **ACCOUNT_NOTIFICATIONS:** `Toronto Moto: Your motorcycle is ready for pickup. Details: https://service.torontomoto.com/c/[token]. Reply STOP to opt out.`
- **MARKETING:** `Toronto Moto: Hi [Name], [offer]. Details: https://torontomoto.com. Reply STOP to unsubscribe.`

## Legal drafts (docs only)

Ship markdown (or HTML fragments) under `docs/compliance/` (or similar):

1. **Privacy Policy** draft for Wix — include verbatim:  
   `All the above categories exclude text messaging originator opt-in data and consent; this information won’t be shared with any third parties.`
2. **Terms / SMS program terms** — business identity (Otomoto Toronto Moto Inc. / Toronto Moto), product description (service updates + optional marketing), frequency, rates, HELP/STOP, carrier liability, support via website, links between PP/ToS.
3. **Twilio verification paste pack** — use cases (CUSTOMER_CARE, ACCOUNT_NOTIFICATIONS, MARKETING), summaries, suggested monthly volume, opt-in description (public `/sms` + intake + portal), keyword copy, soft-rollout note in Additional Details, checklist mapping to toll-free / A2P fields.

Ops after ship: publish on Wix → set env URLs → submit in Twilio Console using paste pack + live `https://service.torontomoto.com/sms`.

## Environment

| Variable                                   | Purpose                         |
| ------------------------------------------ | ------------------------------- |
| `NEXT_PUBLIC_PRIVACY_POLICY_URL`           | Live Privacy on torontomoto.com |
| `NEXT_PUBLIC_TERMS_URL`                    | Live Terms on torontomoto.com   |
| Existing `TWILIO_*`, `NEXT_PUBLIC_APP_URL` | Unchanged                       |

Update `.env.local.example` and production checklist.

## Error handling

- Invalid phone on `/sms` → form error; no partial consent writes.
- Send blocked by opt-out / missing marketing consent → typed service errors in Send Message / billing flows.
- Missing Privacy/Terms env → pages still render; links omit or show placeholder only in non-production; checklist flags as verification blocker.

## Testing

- Unit: soft-rollout allow; marketing gate; STOP block; HELP/STOP/START handlers; `/sms` validation (one program required, boxes default unchecked).
- Manual: `/sms` unchecked defaults; welcome SMS + event row; portal/staff optional consent; HELP/STOP on real number.

## Implementation notes

- Reuse `lib/services/communications.ts`, `lib/twilio/*`, existing webhook signature verification.
- Prefer one consent service module (e.g. `lib/services/smsConsent.ts`) used by `/sms`, CustomerForm actions, portal, and inbound handlers.
- Regenerate or hand-update Supabase types after migration.
- Brand in customer-facing SMS: **Toronto Moto**; legal entity in Terms: **Otomoto Toronto Moto Inc.**
