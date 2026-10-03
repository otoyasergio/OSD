-- Fixed package prices for common maintenance jobs.
UPDATE service SET standard_price = 165
WHERE lower(name) = 'oil change'
  AND (standard_price IS DISTINCT FROM 165);

UPDATE service SET standard_price = 650
WHERE lower(name) IN ('fork seals', 'fork seal', 'fork seal replacement')
  AND (standard_price IS DISTINCT FROM 650);

UPDATE service SET standard_price = 200
WHERE lower(name) = 'coolant service'
  AND (standard_price IS DISTINCT FROM 200);

INSERT INTO service (name, category, standard_price, estimated_labour, active)
SELECT 'Engine Flush with Oil Change', 'Maintenance', 200, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM service s
  WHERE lower(s.name) = 'engine flush with oil change'
);

UPDATE service SET standard_price = 200, category = COALESCE(category, 'Maintenance'), active = true
WHERE lower(name) = 'engine flush with oil change'
  AND (standard_price IS DISTINCT FROM 200);
