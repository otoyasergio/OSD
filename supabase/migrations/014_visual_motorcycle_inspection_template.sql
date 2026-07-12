-- Replace active inspection template with Visual Motorcycle Inspection Report items.
-- Existing inspections keep their category/item name snapshots; only new WOs use these items.

UPDATE inspection_template_item
SET active = false, updated_at = now()
WHERE active = true;

INSERT INTO inspection_template_item (category, item_name, display_order, requires_measurement, active) VALUES
-- Brakes & Tires — Front
('Brakes & Tires — Front', 'Front spokes', 100, false, true),
('Brakes & Tires — Front', 'Front cast', 110, false, true),
('Brakes & Tires — Front', 'Front rims', 120, false, true),
('Brakes & Tires — Front', 'Front bearings', 130, false, true),
('Brakes & Tires — Front', 'Front seals', 140, false, true),
('Brakes & Tires — Front', 'Front brake lining', 150, true, true),
('Brakes & Tires — Front', 'Front tire condition', 160, false, true),
('Brakes & Tires — Front', 'Front tire tread', 170, true, true),
('Brakes & Tires — Front', 'Front wear pattern', 180, false, true),
('Brakes & Tires — Front', 'Front tire pressure before', 190, true, true),
('Brakes & Tires — Front', 'Front tire pressure after', 200, true, true),
('Brakes & Tires — Front', 'Front rotor', 210, false, true),
('Brakes & Tires — Front', 'Front wheel out of round', 220, false, true),
('Brakes & Tires — Front', 'Front seized caliper or brake pad', 230, false, true),
('Brakes & Tires — Front', 'Front advanced dry rot', 240, false, true),

-- Brakes & Tires — Rear
('Brakes & Tires — Rear', 'Rear spokes', 300, false, true),
('Brakes & Tires — Rear', 'Rear cast', 310, false, true),
('Brakes & Tires — Rear', 'Rear rims', 320, false, true),
('Brakes & Tires — Rear', 'Rear bearings', 330, false, true),
('Brakes & Tires — Rear', 'Rear seals', 340, false, true),
('Brakes & Tires — Rear', 'Rear brake lining', 350, true, true),
('Brakes & Tires — Rear', 'Rear tire condition', 360, false, true),
('Brakes & Tires — Rear', 'Rear tire tread', 370, true, true),
('Brakes & Tires — Rear', 'Rear wear pattern', 380, false, true),
('Brakes & Tires — Rear', 'Rear tire pressure before', 390, true, true),
('Brakes & Tires — Rear', 'Rear tire pressure after', 400, true, true),
('Brakes & Tires — Rear', 'Rear rotor', 410, false, true),
('Brakes & Tires — Rear', 'Rear wheel out of round', 420, false, true),
('Brakes & Tires — Rear', 'Rear seized caliper or brake pad', 430, false, true),
('Brakes & Tires — Rear', 'Rear advanced dry rot', 440, false, true),

-- Section skip (marks Brakes & Tires incomplete items as skipped when OK)
('Brakes & Tires', 'Brake Inspection Not Performed This Visit', 450, false, true),

-- Lights, Lenses, Controls and Misc.
('Lights, Lenses, Controls and Misc.', 'Head Light / Tail Light / Turn Signals / Brake Light / Hazard Warning Lights / Reflectors / License Plate Light', 500, false, true),
('Lights, Lenses, Controls and Misc.', 'Windshield, Mirrors, Lenses (cracked, broken, securely mounted, excessive condensation)', 510, false, true),
('Lights, Lenses, Controls and Misc.', 'Switches (function correctly: engine cut-off, hi/low beam, turn signal)', 520, false, true),
('Lights, Lenses, Controls and Misc.', 'Wiring (fraying, chafing, insulation, no interference or pulling at steering, connectors tight)', 530, false, true),
('Lights, Lenses, Controls and Misc.', 'Handlebars (straight, turn freely, hand grips are secure)', 540, false, true),
('Lights, Lenses, Controls and Misc.', 'Levers and Pedal (broken, bent, cracked, tight, lubricated)', 550, false, true),
('Lights, Lenses, Controls and Misc.', 'Cables (fraying, kinks, lubrication, no interference or pulling at steering)', 560, false, true),
('Lights, Lenses, Controls and Misc.', 'Hoses (leaks, bulges, deterioration, no interference or pulling at steering)', 570, false, true),
('Lights, Lenses, Controls and Misc.', 'Throttle (Moves easy, springs closed, no revving when turning handlebars)', 580, false, true),
('Lights, Lenses, Controls and Misc.', 'Dashboard instruments, Locks, Hinges and Generally Clean', 590, false, true),
('Lights, Lenses, Controls and Misc.', 'Spark Plugs (ignition advance)', 600, false, true),
('Lights, Lenses, Controls and Misc.', 'Filters (fuel filter, air filter)', 610, false, true),

-- Frame, Chassis, and Suspension
('Frame, Chassis, and Suspension', 'Frame Condition (Cracked mounts, gussets, or paint lifting)', 700, false, true),
('Frame, Chassis, and Suspension', 'Steering-Head Bearings (raise front wheel, check for play by pulling/pushing forks)', 710, false, true),
('Frame, Chassis, and Suspension', 'Swingarm Bushings (Raise rear wheel, check for play by pushing/pulling swingarm)', 720, false, true),
('Frame, Chassis, and Suspension', 'Front Forks (oil, smooth travel, equal air pressure/damping)', 730, false, true),
('Frame, Chassis, and Suspension', 'Rear Shock(s) (Smooth travel, equal air pressure/damping, free, lubricated linkage)', 740, false, true),
('Frame, Chassis, and Suspension', 'Chain or Belt (Tension, Lubrication, and Sprockets)', 750, false, true),
('Frame, Chassis, and Suspension', 'Fasteners (Tight, missing bolts, nuts, Clips or Cotter Pins)', 760, false, true),
('Frame, Chassis, and Suspension', 'Center stand (Cracks, bent, Springs in place, tension to hold position)', 770, false, true),
('Frame, Chassis, and Suspension', 'Side stand (Cracks, bent, Springs in place, tension to hold position)', 780, false, true),

-- Oil and Other Fluid Levels
('Oil and Other Fluid Levels', 'Engine Oil (checked on level ground, oil full, correct color and pressure)', 800, false, true),
('Oil and Other Fluid Levels', 'Gear Oil (Transmission, rear drive oil full, correct color)', 810, false, true),
('Oil and Other Fluid Levels', 'Shaft Drive Oil (full, correct color)', 820, false, true),
('Oil and Other Fluid Levels', 'Hydraulic Fluid (brakes and clutch reservoirs)', 830, false, true),
('Oil and Other Fluid Levels', 'Coolant (check only when cool)', 840, false, true),
('Oil and Other Fluid Levels', 'Fuel (clean, no moisture, smells fresh)', 850, false, true),
('Oil and Other Fluid Levels', 'Leaks (Engine Oil, Gear Oil, Shaft Drive, Hydraulic Fluid, Coolant, Fuel)', 860, false, true),

-- Battery
('Battery', 'Battery Terminal / Cables / Mountings', 900, false, true),
('Battery', 'Check Condition of Battery (Storage Capacity Test)', 910, false, true),
('Battery', 'Factory Spec Cold Cranking Amps', 920, true, true),
('Battery', 'Actual Cold Cranking Amps', 930, true, true),

-- Comments / damage notes (status optional via skip-friendly notes; still require a status for completion)
('Comments / Damage', 'Comments / Estimates', 1000, false, true),
('Comments / Damage', 'Prior paint, chrome, or trim damage — Left side', 1010, false, true),
('Comments / Damage', 'Prior paint, chrome, or trim damage — Right side', 1020, false, true),
('Comments / Damage', 'Advisor acknowledgment', 1030, false, true),
('Comments / Damage', 'Customer acknowledgment', 1040, false, true);
