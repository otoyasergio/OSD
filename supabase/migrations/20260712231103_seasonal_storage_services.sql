-- Seasonal tune-ups, storage, and battery tender lead — common intake services.
INSERT INTO service (name, category, standard_price, estimated_labour, active)
SELECT v.name, v.category, NULL, NULL, true
FROM (
  VALUES
    ('Spring/Summer Tune Up', 'Seasonal'),
    ('Fall Tune Up', 'Seasonal'),
    ('Winter Storage', 'Storage'),
    ('Daily Storage', 'Storage'),
    ('Monthly Storage', 'Storage'),
    ('Battery Lead Addition', 'Maintenance')
) AS v(name, category)
WHERE NOT EXISTS (
  SELECT 1 FROM service s WHERE lower(s.name) = lower(v.name)
);
