-- Time tracking on jobs: record when work actually starts so estimated vs
-- actual hours can be compared (Shopmonkey time-log pattern).
ALTER TABLE job ADD COLUMN started_at timestamptz;

-- Service level categories for the catalogue (grouping + future reporting).
ALTER TABLE service ADD COLUMN category text;

UPDATE service SET category = 'Maintenance'
WHERE name IN ('Oil Change', 'Coolant Service', 'Air Filter Replacement', 'Spark Plug Replacement', 'Battery Replacement');

UPDATE service SET category = 'Inspection & Diagnostics'
WHERE name IN ('Safety Inspection', 'Diagnostic');

UPDATE service SET category = 'Brakes & Tires'
WHERE name IN ('Tire Change', 'Brake Service');

UPDATE service SET category = 'Drivetrain & Suspension'
WHERE name IN ('Fork Seals', 'Chain And Sprocket');
