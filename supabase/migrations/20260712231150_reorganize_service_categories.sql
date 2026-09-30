-- Reorganize service catalogue into clearer motorcycle-shop categories.

UPDATE service SET category = 'Oil & Fluids'
WHERE lower(name) IN (
  'oil change',
  'engine flush with oil change',
  'coolant service',
  'gear oil change',
  'transmission oil change',
  'primary oil change',
  'shaft drive oil change'
);

UPDATE service SET category = 'Filters & Ignition'
WHERE lower(name) IN (
  'air filter replacement',
  'spark plug replacement'
);

UPDATE service SET category = 'Electrical'
WHERE lower(name) IN (
  'battery replacement',
  'battery lead addition'
);

UPDATE service SET category = 'Brakes'
WHERE lower(name) IN (
  'front brake service',
  'rear brake service',
  'brake service'
);

UPDATE service SET category = 'Tires'
WHERE lower(name) IN (
  'front tire',
  'rear tire',
  'tire change'
);

UPDATE service SET category = 'Chain & Drive'
WHERE lower(name) IN (
  'chain and sprocket',
  'chain clean',
  'chain clean and tension'
);

UPDATE service SET category = 'Suspension'
WHERE lower(name) IN (
  'fork seals',
  'fork seal',
  'fork seal replacement'
);

UPDATE service SET category = 'Inspection & Diagnostics'
WHERE lower(name) IN (
  'diagnostic',
  'safety inspection'
);

UPDATE service SET category = 'Seasonal'
WHERE lower(name) IN (
  'fall tune up',
  'spring/summer tune up'
);

UPDATE service SET category = 'Storage'
WHERE lower(name) IN (
  'daily storage',
  'monthly storage',
  'winter storage'
);

UPDATE service SET category = 'Other'
WHERE lower(name) = 'custom service'
  OR category IS NULL;
