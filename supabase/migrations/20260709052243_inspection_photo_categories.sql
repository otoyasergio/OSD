-- Inspection report photos: categories + optional link to inspection_result for flagged items.

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
    'inspection_item'
  ));

ALTER TABLE intake_photo
  ADD COLUMN IF NOT EXISTS inspection_result_id uuid
    REFERENCES inspection_result(inspection_result_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_intake_photo_inspection_result_id
  ON intake_photo (inspection_result_id)
  WHERE inspection_result_id IS NOT NULL;
