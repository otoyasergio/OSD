-- Fixed package price for Safety Inspection (not billed at hourly shop rate).
UPDATE service
SET standard_price = 250
WHERE lower(name) = 'safety inspection'
  AND (standard_price IS DISTINCT FROM 250);
