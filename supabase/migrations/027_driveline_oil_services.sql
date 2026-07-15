-- Driveline oil services commonly selected at intake.
INSERT INTO service (name, category, standard_price, estimated_labour, active)
SELECT v.name, v.category, NULL, NULL, true
FROM (
  VALUES
    ('Gear Oil Change', 'Maintenance'),
    ('Transmission Oil Change', 'Maintenance'),
    ('Primary Oil Change', 'Maintenance'),
    ('Shaft Drive Oil Change', 'Maintenance')
) AS v(name, category)
WHERE NOT EXISTS (
  SELECT 1 FROM service s WHERE lower(s.name) = lower(v.name)
);
