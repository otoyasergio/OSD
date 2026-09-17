-- Phase B: job-level labor clocking (separate from attendance payroll punches)

CREATE TABLE IF NOT EXISTS job_time_entry (
  job_time_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  notes text,
  CONSTRAINT job_time_end_after_start CHECK (
    ended_at IS NULL OR ended_at >= started_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_time_open_per_user
  ON job_time_entry (user_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_time_job
  ON job_time_entry (job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_time_location
  ON job_time_entry (location_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_time_user
  ON job_time_entry (user_id, started_at DESC);

ALTER TABLE job_time_entry ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_time_select ON job_time_entry
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'head_tech')
      OR location_id IN (SELECT public.user_location_ids())
    )
  );

CREATE POLICY job_time_insert ON job_time_entry
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND user_id = current_app_user_id()
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY job_time_update ON job_time_entry
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager')
    )
  );

CREATE POLICY job_time_delete ON job_time_entry
  FOR DELETE TO authenticated
  USING (current_app_user_role() IN ('owner', 'manager'));
