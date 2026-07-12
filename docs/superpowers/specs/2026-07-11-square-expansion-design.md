# OTOMOTO Square-first expansion (A–F)

**Date:** 2026-07-11  
**Status:** Implemented on `feature/square-expansion`  
**Supersedes:** V1/V2 non-goals for invoicing, customer portal, and SMS

## Scope

| Phase | Feature |
|-------|---------|
| A | Digital drop-off contract + iPad e-sign |
| F | YMM fitment catalogue on `/parts` |
| B | Square invoices, credits, webhooks; QBO via Square Connector (ops) |
| D | Twilio SMS + Resend email templates |
| C | Customer magic-link portal `/c/[token]` |
| E | Wix Bookings webhook → work order stub |

## Environment

See `.env.local.example` for Square, Twilio, Resend, Wix, and fitment import variables.

## Operations

- **QuickBooks:** Connect Square in QBO (Square Connector) — no custom QBO API in-app.
- **Fitment import:** `FITMENT_CSV_PATH=... npx tsx scripts/import-fitment.ts`
- **Wix Bookings:** POST `/api/wix/webhooks/bookings` with `WIX_WEBHOOK_SECRET`
- **Square webhooks:** POST `/api/square/webhooks`
- **Twilio inbound SMS:** POST `/api/twilio/webhooks`
