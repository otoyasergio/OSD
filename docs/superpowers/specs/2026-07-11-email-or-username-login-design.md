# Email or Username Login — Design

**Date:** 2026-07-11  
**Status:** Approved for implementation planning  
**App:** OTOMOTO Workshop Management (Next.js + Supabase Auth)

## 1. Objective

Staff can sign in with **either email or username** + password. Username is a short shop handle derived from the person’s name (e.g. Sergio Otoya → `sotoya`), so floor staff can log in without typing a full email on iPad.

## 2. Decisions

| Topic | Decision |
|-------|----------|
| Approach | Username stored on `app_user`; resolve to email before Supabase `signInWithPassword` |
| Username format | Lowercase first initial + last name, letters/digits only (`sotoya`) |
| Collisions | Append `2`, `3`, … (`sotoya2`) |
| Rename behavior | Username does **not** auto-update when name changes; owner/manager may edit |
| Email login | Continues to work unchanged |
| Password reset | Remains email-based (out of scope for username) |
| Lookup | Server action only; generic error on failure |

## 3. Data model

Add to `app_user`:

- `username text UNIQUE NOT NULL`

### Generation rules

1. Take `first_name` and `last_name`
2. Build base: lowercase first character of first name + lowercase last name
3. Strip everything except `a-z` and `0-9`
4. If empty after strip, fall back to a safe placeholder (e.g. `user`) then apply collision rules
5. If base is taken, try `base2`, `base3`, … until unique

### Backfill

Existing `app_user` rows receive usernames using the same rules in a migration (or one-time SQL after the column is added).

### Editing

Owner/manager can change `username` on staff create/edit. New value must match `^[a-z0-9]+$` and remain unique.

## 4. Login flow

1. Login form field label: **Email or username** (not email-only; input type `text`, not `email`)
2. Submit password + identifier to a server action
3. Server:
   - Trim identifier
   - If it contains `@` → use as email
   - Else → look up `app_user` by `username` (case-insensitive) where status is active (and linked to Auth); resolve to that row’s `email`
   - Call Supabase Auth `signInWithPassword` with resolved email + password
4. On any failure (unknown username, inactive user, bad password): return the same generic message (e.g. “Invalid login credentials”) — do not disclose whether the username exists
5. On success: same session/cookie path as today; redirect to dashboard

### Security notes

- Username → email resolution must not be a public, unauthenticated browser query against a wide `app_user` select
- Prefer a narrow server-only lookup (service role or a dedicated RPC that returns only the email for a valid active username)
- Rate limiting remains whatever Supabase Auth already applies to password sign-in

## 5. Staff UI

- **Create staff:** show generated username after save (or preview before save) so the person knows what to type
- **Edit / profile:** display username; allow owner/manager to edit with uniqueness validation
- **Login page:** label “Email or username”; helper text optional (e.g. “e.g. sotoya or you@example.com”)

## 6. Out of scope

- Password reset via username
- Changing Auth primary identity away from email
- Customer / public login
- Auto-renaming username when first/last name changes

## 7. Acceptance criteria

- [ ] Staff can sign in with email + password (existing behavior)
- [ ] Staff can sign in with username + password (e.g. `sotoya`)
- [ ] Username is case-insensitive at login (`Sotoya` works)
- [ ] New users get auto-generated unique usernames (`sotoya`, `sotoya2`, …)
- [ ] Existing users are backfilled
- [ ] Wrong username/password shows a generic error
- [ ] Owner/manager can view and edit username on staff records
- [ ] Password reset still uses email
