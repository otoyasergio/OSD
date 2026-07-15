-- Chain cleaning services commonly selected at intake.
INSERT INTO service (name, category, standard_price, estimated_labour, active)
SELECT v.name, v.category, NULL, NULL, true
FROM (
  VALUES
    ('Chain Clean and Tension', 'Drivetrain & Suspension'),
    ('Chain Clean', 'Drivetrain & Suspension')
) AS v(name, category)
WHERE NOT EXISTS (
  SELECT 1 FROM service s WHERE lower(s.name) = lower(v.name)
);
