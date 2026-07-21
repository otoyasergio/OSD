-- Workflow V2: work-journal photos ('job_work') are in-progress shots a
-- technician attaches to a job. They are distinct from 'job_proof' (the after
-- photo) and MUST NOT satisfy the proof-of-work completion gate.
-- Additive: recreate the category check with every existing category plus
-- 'job_work'.

ALTER TABLE intake_photo
  DROP CONSTRAINT IF EXISTS intake_photo_category_check;

ALTER TABLE intake_photo
  ADD CONSTRAINT intake_photo_category_check CHECK (category IN (
    'front',
    'rear',
    'left_side',
    'right_side',
    'odometer',
    'vin',
    'damage',
    'accessories',
    'fuel_level',
    'other',
    'inspection_tires',
    'inspection_brakes',
    'inspection_forks',
    'inspection_item',
    'job_proof',
    'job_work'
  ));
