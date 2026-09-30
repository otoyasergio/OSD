-- Pit Board floor state: acknowledge assignment + park with wait owner.

ALTER TABLE job
  ADD COLUMN IF NOT EXISTS floor_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS floor_acknowledged_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS floor_parked_at timestamptz,
  ADD COLUMN IF NOT EXISTS floor_park_reason text
    CHECK (
      floor_park_reason IS NULL
      OR floor_park_reason IN ('parts', 'approval', 'tool', 'other', 'swapped')
    ),
  ADD COLUMN IF NOT EXISTS floor_wait_owner text
    CHECK (
      floor_wait_owner IS NULL
      OR floor_wait_owner IN ('front_desk', 'technician')
    );

CREATE INDEX IF NOT EXISTS idx_job_floor_parked
  ON job (assigned_technician_id, floor_parked_at)
  WHERE floor_parked_at IS NOT NULL;

COMMENT ON COLUMN job.floor_acknowledged_at IS
  'Tech tapped Got it after admin assigned the job to their docket.';
COMMENT ON COLUMN job.floor_parked_at IS
  'Tech parked the bike (Pit Board); timer paused and spot saved.';
COMMENT ON COLUMN job.floor_park_reason IS
  'parts | approval | tool | other | swapped';
COMMENT ON COLUMN job.floor_wait_owner IS
  'Who owns the wait: front_desk (default park reasons) or technician (other).';
