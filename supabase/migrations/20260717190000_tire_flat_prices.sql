-- Shop flat prices for tire changes (not billed at hourly rate).
UPDATE service
SET standard_price = 110
WHERE lower(name) = 'front tire'
  AND (standard_price IS DISTINCT FROM 110);

UPDATE service
SET standard_price = 120
WHERE lower(name) = 'rear tire'
  AND (standard_price IS DISTINCT FROM 120);

UPDATE service
SET standard_price = 120
WHERE lower(name) = 'tire change'
  AND (standard_price IS DISTINCT FROM 120);
