# Security

OTOMOTO Workshop Management — operational security notes for production.

## Webhook authentication (required)

All public webhook routes use the service-role Supabase client. They **must**
verify signatures / secrets or fail closed.

| Endpoint                          | Auth                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/square/webhooks`       | HMAC-SHA256 (`x-square-hmacsha256-signature`) using `SQUARE_WEBHOOK_SIGNATURE_KEY` over `NEXT_PUBLIC_APP_URL` + path + raw body |
| `POST /api/twilio/webhooks`       | Twilio `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN`                                                                           |
| `POST /api/wix/webhooks/bookings` | `Authorization: Bearer ${WIX_WEBHOOK_SECRET}` — **fail closed** if secret unset                                                 |
| `POST /api/wix/webhooks/contacts` | `Authorization: Bearer ${WIX_WEBHOOK_SECRET}` — **fail closed** if secret unset                                                 |
| `GET /api/cron/parts-canada-sync` | `Authorization: Bearer ${CRON_SECRET}` only (no query-string secret)                                                            |
| `GET /api/cron/wix-contacts-sync` | `Authorization: Bearer ${CRON_SECRET}` only (no query-string secret)                                                            |

Set `NEXT_PUBLIC_APP_URL` to the exact public HTTPS origin registered with Square/Twilio
so signature URLs match.

## Rate limiting

In-memory limits apply per IP on:

- Login (`assertLoginAllowed`) — 10 / 15 minutes
- Portal actions — 30 / minute
- Webhooks — 60–120 / minute

For multi-instance production at scale, prefer Vercel Firewall or Upstash Redis.

## Secrets

- Never commit `.env.local`
- `SUPABASE_SERVICE_ROLE_KEY` is server-only (bypasses RLS)
- Rotate `CRON_SECRET`, webhook secrets, and demo passwords before production
- Enable **leaked password protection** in Supabase Auth → Password security

## Session hygiene

- Staff sign-out is available in the app chrome (`SignOutButton`)
- Active location cookie is `httpOnly`, `sameSite=lax`, `secure` in production
- Middleware protects `/billing` and `/complete` in addition to core routes

## Contract HTML

Owner/manager-authored drop-off contract HTML is sanitized on publish and render
(`lib/security/sanitizeHtml.ts`) to strip scripts, iframes, and inline handlers.

## Reporting security incidents

1. Rotate compromised secrets in Vercel + provider consoles
2. Redeploy previous known-good Vercel deployment if needed
3. Review owner audit log and Supabase Auth failed logins
