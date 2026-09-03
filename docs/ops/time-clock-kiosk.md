# Tablet PIN time clock kiosk

Shop-floor staff (technicians, head tech, service advisors) punch in/out and start/end meal breaks on a dedicated tablet account. Owner/manager still self-clock in the app; Control Center can still punch floor techs.

## Create the kiosk Auth user

1. In **Supabase → Authentication → Users**, create a user (email + strong password). Prefer a shop-owned mailbox such as `kiosk@yourshop.com`.
2. Copy the Auth user UUID (`auth.users.id`).
3. In the app: **Settings → Users → Link Auth user**:
   - Paste the Auth UUID
   - Name: e.g. `Front` / `Kiosk`
   - Role: **Time clock kiosk**
   - Assign the shop **location** the tablet sits in
4. Sign in on the tablet with that Auth email/password. The app redirects to `/kiosk`.

## Set staff PINs

1. **Settings → Users → Staff profile · PIN & EE docs** (or `/settings/staff/<user_id>`).
2. Enter a unique **4-digit PIN** for each punchable staff member (technician, head tech, service advisor).
3. PINs are stored as salted scrypt hashes (`time_clock_pin_hash`). Never log or display the PIN after save.

## Tablet setup

1. Mount a dedicated tablet at the clock station; lock it to the kiosk browser/PWA if available.
2. Open `https://service.torontomoto.com/kiosk` (or your deploy URL) and stay signed in as the kiosk user.
3. Grant **camera** permission for the site (front-facing / `facingMode: user`). Every punch requires a photo stored in the private `time-clock-photos` bucket.
4. Flow: tap name → enter PIN → take photo → Sign in / Sign out / Start meal / End meal.

## Security notes

- The kiosk role cannot use messenger or the main shop shell (`app/(app)` redirects to `/kiosk`).
- After 5 failed PIN attempts for a staff member (per kiosk process), PIN entry locks for 60 seconds.
- Only owner/manager can set or clear PINs (via `set_app_user_time_clock_pin` RPC).
- Photos path pattern: `{location_id}/{user_id}/{entry_or_break_id}/{in|out|break_start|break_end}.jpg`.

## Troubleshooting

| Symptom                        | Check                                                      |
| ------------------------------ | ---------------------------------------------------------- |
| Redirected away from `/kiosk`  | User role is not `time_clock_kiosk`                        |
| “No location”                  | Kiosk user has no `user_location` row                      |
| Staff missing from grid        | Staff inactive, wrong location, or role not punchable      |
| “No PIN set”                   | Set PIN on staff profile                                   |
| Camera error                   | Browser permission; use HTTPS; prefer Chrome/Safari        |
| PIN always wrong after migrate | Confirm migration `047_time_clock_pin_manager_rpc` applied |
