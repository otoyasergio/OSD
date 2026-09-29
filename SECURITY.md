# Security

OTOMOTO Workshop Management — operational security notes for production.

## Webhook authentication (required)

All public webhook routes use the service-role Supabase client. They **must**
verify signatures / secrets or fail closed.

| Endpoint                             | Auth                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/square/webhooks`          | HMAC-SHA256 (`x-square-hmacsha256-signature`) using `SQUARE_WEBHOOK_SIGNATURE_KEY` over `NEXT_PUBLIC_APP_URL` + path + raw body |
| `POST /api/twilio/webhooks`          | Twilio `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN`                                                                           |
| `POST /api/twilio/status`            | Twilio `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN` (delivery status callbacks)                                               |
| `POST /api/twilio/voice/inbound`     | Twilio `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN` (PSTN inbound TwiML)                                                      |
| `POST /api/twilio/voice/outbound`    | Twilio `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN` (TwiML App Voice URL)                                                     |
| `POST /api/twilio/voice/status`      | Twilio `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN` (Voice status callbacks)                                                  |
| `POST /api/twilio/voice/dial-action` | Twilio `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN` (inbound Dial action / missed prompt)                                     |
| `POST /api/wix/webhooks/bookings`    | `Authorization: Bearer ${WIX_WEBHOOK_SECRET}` — **fail closed** if secret unset                                                 |
| `POST /api/wix/webhooks/contacts`    | `Authorization: Bearer ${WIX_WEBHOOK_SECRET}` — **fail closed** if secret unset                                                 |
| `GET /api/cron/parts-canada-sync`    | `Authorization: Bearer ${CRON_SECRET}` only (no query-string secret)                                                            |
| `GET /api/cron/wix-contacts-sync`    | `Authorization: Bearer ${CRON_SECRET}` only (no query-string secret)                                                            |

Set `NEXT_PUBLIC_APP_URL` to the exact public HTTPS origin registered with Square/Twilio
so signature URLs match.

## Rate limiting

In-memory limits apply per IP on:

- Login (`assertLoginAllowed`) — 10 / 15 minutes
- Portal actions — 30 / minute
- Webhooks — 60–120 / minute

For multi-instance production at scale, prefer Vercel Firewall or Upstash Redis.
Ask OTOMOTO is also process-local (12 turns per staff ID per minute). It is not a
distributed/account-wide limit; every server process has its own counter.

## Secrets

- Never commit `.env.local`
- `SUPABASE_SERVICE_ROLE_KEY` is server-only (bypasses RLS)
- `OPENAI_API_KEY` is server-only; never use a `NEXT_PUBLIC_*` AI key
- Rotate `CRON_SECRET`, webhook secrets, and demo passwords before production
- Enable **leaked password protection** in Supabase Auth → Password security

## Ask OTOMOTO AI data

Ask OTOMOTO is an internal drafting tool for **OTOMOTO TORONTO MOTO INC.** Minimize
provider context to the authorized work order/job: omit customer contact details,
full VIN unless genuinely required, signatures, storage URLs, unrelated notes,
and unselected photos. Only explicitly selected current-turn photos may be sent.
Never use production/customer data in provider evals.

Responses API requests use `store: false`, but OpenAI abuse-monitoring logs may
still retain content for up to 30 days unless the account has an applicable
approved retention control. App conversation history remains in Supabase and is
subject to work-order access, retention, and cascade rules.

Record and review both the requested alias and resolved provider model. Any alias,
resolved-model, prompt, schema, policy, or source-set change requires the complete
synthetic live-model acceptance suite and qualified technician/advisor signoff.
The current AI rate limit is per process, so it must not be represented as a
global abuse-control boundary.

## Session hygiene

- Staff sign-out is available in the app chrome (`SignOutButton`)
- Active location cookie is `httpOnly`, `sameSite=lax`, `secure` in production
- Next.js Proxy verifies Supabase JWT claims, refreshes auth cookies with
  no-cache headers, and protects every non-public page by default

## Contract HTML

Owner/manager-authored drop-off contract HTML is sanitized on publish and render
(`lib/security/sanitizeHtml.ts`) to strip scripts, iframes, and inline handlers.

## Reporting security incidents

1. Rotate compromised secrets in Vercel + provider consoles
2. Redeploy previous known-good Vercel deployment if needed
3. Review owner audit log and Supabase Auth failed logins
