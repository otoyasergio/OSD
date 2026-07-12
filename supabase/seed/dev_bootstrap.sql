-- =============================================================================
-- OTOMOTO V1 — local / acceptance bootstrap seed
-- =============================================================================
-- Prerequisites (do these first):
--   1. Apply migrations 001 → 013 in order (see README Getting started).
--   2. Create Auth users (Dashboard, Auth Admin API, or SQL into auth.users
--      + auth.identities). Copy each user's UUID (auth.users.id).
--
-- What this script does:
--   - Inserts one sample location (Toronto / TOR) if missing
--   - Ensures work_order_sequence starts at 1001 for that location
--
-- What this script does NOT do:
--   - Create Auth users (must be done in the Dashboard, Auth Admin API, or
--     matching SQL inserts into auth.users + auth.identities)
--   - Invent credentials — you supply the real auth_user_id below
--
-- After running the location seed, link Auth users → app_user → user_location
-- using the demo-account template at the bottom (replace placeholders).
-- =============================================================================
--
-- Demo staff accounts (dev / acceptance only — change passwords after first login):
--
-- | Role            | Email                   | Temp password  |
-- |-----------------|-------------------------|----------------|
-- | owner           | owner@otomoto.local     | Otomoto2026!   |
-- | manager         | manager@otomoto.local   | Otomoto2026!   |
-- | service_advisor | advisor@otomoto.local   | Otomoto2026!   |
-- | technician      | tech@otomoto.local      | Otomoto2026!   |
--
-- Create each Auth user first (email confirmed), then run the link block below
-- with the matching auth.users.id values. Do not commit service_role keys.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sample location + work-order sequence
-- ---------------------------------------------------------------------------
INSERT INTO location (name, code, status)
VALUES ('Toronto', 'TOR', 'active')
ON CONFLICT (code) DO NOTHING;

INSERT INTO work_order_sequence (location_id, next_number)
SELECT location_id, 1001
FROM location
WHERE code = 'TOR'
ON CONFLICT (location_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Link Auth users → app_user (roles) → user_location (Toronto)
-- ---------------------------------------------------------------------------
-- Run AFTER you have created the Auth users and know their UUIDs.
--
-- Replace each '<…_AUTH_USER_UUID>' with auth.users.id for that email.
--
-- Example (uncomment and edit before running):
--
-- INSERT INTO app_user (
--   auth_user_id, first_name, last_name, email, role, status
-- ) VALUES
--   ('<OWNER_AUTH_USER_UUID>'::uuid,   'Owner',   'User', 'owner@otomoto.local',   'owner',           'active'),
--   ('<MANAGER_AUTH_USER_UUID>'::uuid, 'Manager', 'User', 'manager@otomoto.local', 'manager',         'active'),
--   ('<ADVISOR_AUTH_USER_UUID>'::uuid, 'Advisor', 'User', 'advisor@otomoto.local', 'service_advisor', 'active'),
--   ('<TECH_AUTH_USER_UUID>'::uuid,    'Tech',    'User', 'tech@otomoto.local',    'technician',      'active')
-- ON CONFLICT (email) DO UPDATE
--   SET auth_user_id = EXCLUDED.auth_user_id,
--       first_name = EXCLUDED.first_name,
--       last_name = EXCLUDED.last_name,
--       role = EXCLUDED.role,
--       status = 'active',
--       updated_at = now();
--
-- INSERT INTO user_location (user_id, location_id)
-- SELECT u.user_id, l.location_id
-- FROM app_user u
-- CROSS JOIN location l
-- WHERE u.email IN (
--   'owner@otomoto.local',
--   'manager@otomoto.local',
--   'advisor@otomoto.local',
--   'tech@otomoto.local'
-- )
--   AND l.code = 'TOR'
-- ON CONFLICT (user_id, location_id) DO NOTHING;
--
-- Optional second location (for location-switch / WO-number acceptance):
--
-- INSERT INTO location (name, code, status)
-- VALUES ('Mississauga', 'MIS', 'active')
-- ON CONFLICT (code) DO NOTHING;
--
-- INSERT INTO work_order_sequence (location_id, next_number)
-- SELECT location_id, 1001
-- FROM location
-- WHERE code = 'MIS'
-- ON CONFLICT (location_id) DO NOTHING;
--
-- INSERT INTO user_location (user_id, location_id)
-- SELECT u.user_id, l.location_id
-- FROM app_user u
-- CROSS JOIN location l
-- WHERE u.email = 'owner@otomoto.local'
--   AND l.code = 'MIS'
-- ON CONFLICT (user_id, location_id) DO NOTHING;
-- =============================================================================
