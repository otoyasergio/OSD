# Changelog

## Unreleased — industry audit hardening (2026-07-12)

### Security

- Square, Twilio, and Wix webhook signature / secret verification (fail-closed)
- Cron auth Bearer-only (removed query-string secret)
- Rate limiting on login, portal actions, and webhooks
- Secure location cookie in production
- Contract HTML sanitization (script/handler stripping via `lib/security/sanitizeHtml.ts`)
- Location-scoped RLS for work orders, jobs, inspections, parts, photos, timeline, time clock (`034_location_scoped_rls.sql`)

### Production readiness

- GitHub Actions CI (typecheck, lint, test, build)
- Error / not-found / loading UI shells
- Optional Sentry + structured JSON logging
- Staff sign-out; middleware protects `/billing` and `/complete`
- Playwright smoke tests for login a11y and webhook rejection
- Vitest coverage thresholds; Prettier + Husky lint-staged
- Complete `.env.local.example`

### Features & UX

- Shop reports dashboard (`/settings/reports`) for owners/managers
- Field-level validation + a11y on customer form; skip link; SubmitButton `aria-busy`
- Lazy-loaded create work order form; request-scoped service catalogue cache
- Bundle analyzer via `npm run analyze`
