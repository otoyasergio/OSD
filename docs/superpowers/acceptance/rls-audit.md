# RLS security audit (OTOMOTO V2 Task 17)

**Project:** `eofxprepuajpqyvlolhw`  
**Date:** 2026-07-09  
**Migrations:** `006_rls_policies.sql`, `009_user_preferences.sql`, `012_rls_hardening.sql`

Authorization truth remains in `lib/permissions` + `lib/services/*`. RLS is defense in depth for the Supabase Data API.

## Policy matrix (public schema)

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
|-------|--------|--------|--------|--------|-------|
| `app_user` | active app user | **owner** | **owner** | — | Owner write policies added in 012 |
| `customer` | active | active | active | — | App-layer role gates |
| `motorcycle` | active | active | active | — | |
| `motorcycle_service_information` | active | active | active | — | |
| `service` | active | active | active | — | Catalogue; owner/manager in app |
| `work_order` | active | active | active | — | Location scoping in services |
| `work_order_technician` | active | active | — | — | |
| `job` | active | active | active | — | |
| `inspection` | active | active | active | — | |
| `inspection_template_item` | active | active | active | — | |
| `inspection_result` | active | active | active | — | |
| `recommendation` | active | active | active | — | Soft status only; no hard delete |
| `part` | active | active | active | — | |
| `intake_photo` | active | active | — | — | Storage bucket separate |
| `technician_note` | active | active | — | — | Append-oriented |
| `timeline_event` | active | active | — | — | Append-only in app |
| `location` | active | active | active | — | Owner-gated in app |
| `user_location` | active | active | — | active | Membership edits owner-gated |
| `work_order_sequence` | active | active | active | — | Prefer `mint_work_order_number` |
| `audit_log` | **owner only** | active | **deny** | **deny** | Append-only; UI via `lib/services/audit.ts` |
| `user_preference` | own rows | own rows | own rows | own rows | `user_id = current_app_user_id()` |

`active` = `is_active_app_user()` (linked `app_user` with `status = 'active'`).

### Storage (`intake-photos`)

Authenticated active users: SELECT / INSERT / UPDATE / DELETE on objects in bucket `intake-photos` (private bucket, 10 MB, image MIME allow-list).

## Hardening applied (012)

1. **`mint_work_order_number`** — `SECURITY DEFINER` + fixed `search_path = public` + active-user guard (fixes mutable search_path advisor).
2. **Revoke anon/PUBLIC EXECUTE** on `current_app_user_id`, `current_app_user_role`, `is_active_app_user`, `mint_work_order_number`; grant to `authenticated` + `service_role` only.
3. **`app_user` owner INSERT/UPDATE** policies (previously SELECT-only → writes silently failed under RLS).
4. **`audit_log` explicit deny** UPDATE/DELETE for `authenticated`.

## Role checks (SQL / expected)

| Check | Expected |
|-------|----------|
| Technician JWT `SELECT audit_log` | 0 rows (owner policy) |
| Non-owner `UPDATE app_user` | 0 rows / denied |
| User A `SELECT user_preference` for user B | 0 rows |
| Anon `rpc/current_app_user_id` | permission denied |
| Authenticated `rpc/mint_work_order_number` | allowed when active app user |

## Remaining advisor warnings (accepted)

Re-ran Supabase security advisors after 012. Cleared: mutable search_path on mint; anon EXECUTE on SECURITY DEFINER helpers.

| Finding | Level | Disposition |
|---------|-------|-------------|
| `authenticated` can EXECUTE SECURITY DEFINER helpers (`current_app_user_*`, `is_active_app_user`, `mint_work_order_number`) | WARN | **Accepted.** Required for RLS policies and WO number minting via the authenticated client. Functions only expose session-derived identity or guarded mint; not secrets. Remediation docs: [lint 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). |
| Leaked password protection disabled (HaveIBeenPwned) | WARN | **Ops follow-up.** Enable in Supabase Auth → Password security before production cutover. Docs: [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |

## Known RLS design notes

- Operational tables allow any **active** authenticated app user to SELECT/INSERT/UPDATE at the DB layer. Fine-grained role and location rules are enforced in Next.js server actions (`lib/permissions` + services). Tightening RLS to role/location would be a future migration if the Data API is exposed more broadly.
- No hard DELETE policies on most operational tables (matches soft-delete / status-cancel product rules).
- Tasks 14–15 (time clock / fleet tags) were skipped; no extra tables to policy in this pass.
