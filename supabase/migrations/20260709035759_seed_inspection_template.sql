INSERT INTO inspection_template_item (category, item_name, display_order, requires_measurement, active) VALUES
('Exterior', 'Body panels', 10, false, true),
('Exterior', 'Mirrors', 20, false, true),
('Exterior', 'Lighting lenses', 30, false, true),
('Exterior', 'Seat and trim', 40, false, true),
('Exterior', 'Visible leaks', 50, false, true),
('Exterior', 'Fasteners', 60, false, true),

('Controls', 'Throttle operation', 100, false, true),
('Controls', 'Clutch lever', 110, false, true),
('Controls', 'Brake levers', 120, false, true),
('Controls', 'Handlebar movement', 130, false, true),
('Controls', 'Switch operation', 140, false, true),

('Fluids', 'Engine oil condition', 200, false, true),
('Fluids', 'Brake fluid level', 210, false, true),
('Fluids', 'Coolant level', 220, false, true),
('Fluids', 'Fork seal leaks', 230, false, true),

('Brakes', 'Front brake pad thickness', 300, true, true),
('Brakes', 'Rear brake pad thickness', 310, true, true),
('Brakes', 'Front rotor condition', 320, false, true),
('Brakes', 'Rear rotor condition', 330, false, true),
('Brakes', 'Brake hose condition', 340, false, true),

('Tires', 'Front tire tread depth', 400, true, true),
('Tires', 'Rear tire tread depth', 410, true, true),
('Tires', 'Tire age and cracking', 420, false, true),
('Tires', 'Tire pressure', 430, true, true),

('Drivetrain', 'Chain condition', 500, false, true),
('Drivetrain', 'Chain slack', 510, true, true),
('Drivetrain', 'Sprocket condition', 520, false, true),
('Drivetrain', 'Belt condition', 530, false, true),

('Electrical', 'Battery condition', 600, false, true),
('Electrical', 'Charging voltage', 610, true, true),
('Electrical', 'Headlight', 620, false, true),
('Electrical', 'Brake light', 630, false, true),
('Electrical', 'Turn signals', 640, false, true),
('Electrical', 'Horn', 650, false, true),

('Safety', 'Side stand switch', 700, false, true),
('Safety', 'Kill switch', 710, false, true),
('Safety', 'Wheel bearings', 720, false, true),
('Safety', 'Steering head bearings', 730, false, true),

('Road Test', 'Starts and idles', 800, false, true),
('Road Test', 'Acceleration', 810, false, true),
('Road Test', 'Braking performance', 820, false, true),
('Road Test', 'Handling', 830, false, true),
('Road Test', 'Abnormal noise', 840, false, true);
