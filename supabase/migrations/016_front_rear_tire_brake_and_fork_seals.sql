-- Split generic tire/brake catalogue entries into front/rear variants,
-- keep historical rows (deactivate only), and ensure Fork seals is active.

-- Deactivate legacy generics (jobs keep service_id + name snapshots).
UPDATE service
SET active = false, updated_at = now()
WHERE name IN ('Tire Change', 'Brake Service')
  AND active = true;

-- Rename seed "Fork Seals" to clear catalogue label; ensure active + category.
UPDATE service
SET
  name = 'Fork seals',
  active = true,
  category = 'Drivetrain & Suspension',
  updated_at = now()
WHERE name = 'Fork Seals';

UPDATE service
SET
  active = true,
  category = COALESCE(NULLIF(TRIM(category), ''), 'Drivetrain & Suspension'),
  updated_at = now()
WHERE name = 'Fork seals';

INSERT INTO service (name, standard_price, estimated_labour, active, category)
SELECT 'Fork seals', NULL, 3.0, true, 'Drivetrain & Suspension'
WHERE NOT EXISTS (SELECT 1 FROM service WHERE name = 'Fork seals');

-- Front/rear tire and brake services.
INSERT INTO service (name, standard_price, estimated_labour, active, category)
VALUES
  ('Front tire', NULL, 1.0, true, 'Brakes & Tires'),
  ('Rear tire', NULL, 1.0, true, 'Brakes & Tires'),
  ('Front brake service', NULL, 1.5, true, 'Brakes & Tires'),
  ('Rear brake service', NULL, 1.5, true, 'Brakes & Tires')
ON CONFLICT (name) DO UPDATE
SET
  active = true,
  estimated_labour = EXCLUDED.estimated_labour,
  category = EXCLUDED.category,
  updated_at = now();
