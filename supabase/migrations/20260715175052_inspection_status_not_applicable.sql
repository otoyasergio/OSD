-- Allow N/A on inspection checklist items.

ALTER TABLE inspection_result
  DROP CONSTRAINT IF EXISTS inspection_result_status_check;

ALTER TABLE inspection_result
  ADD CONSTRAINT inspection_result_status_check
  CHECK (
    status IS NULL
    OR status IN (
      'ok',
      'future_attention',
      'immediate_attention',
      'not_applicable'
    )
  );

COMMENT ON COLUMN inspection_result.status IS
  'ok | future_attention | immediate_attention | not_applicable (null = incomplete)';
