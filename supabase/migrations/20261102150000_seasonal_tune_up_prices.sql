-- Seasonal tune-ups are a fixed pre-tax package. Oil change stays $165.
UPDATE service
SET standard_price = 500
WHERE lower(name) IN ('fall tune up', 'spring/summer tune up')
  AND (standard_price IS DISTINCT FROM 500);
