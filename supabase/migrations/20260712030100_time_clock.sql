-- V2 Task 14: optional technician time clock punch in/out

CREATE TABLE IF NOT EXISTS time_clock_entry (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  clock_in_at timestamptz NOT NULL DEFAULT now(),
  clock_out_at timestamptz,
  notes text,
  CONSTRAINT time_clock_out_after_in CHECK (
    clock_out_at IS NULL OR clock_out_at >= clock_in_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_time_clock_open_per_user
  ON time_clock_entry (user_id)
  WHERE clock_out_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_clock_location_in
  ON time_clock_entry (location_id, clock_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_clock_user_in
  ON time_clock_entry (user_id, clock_in_at DESC);

ALTER TABLE time_clock_entry ENABLE ROW LEVEL SECURITY;

CREATE POLICY time_clock_select ON time_clock_entry
  FOR SELECT TO authenticated
  USING (
    user_id = current_app_user_id()
    OR current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY time_clock_insert ON time_clock_entry
  FOR INSERT TO authenticated
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY time_clock_update ON time_clock_entry
  FOR UPDATE TO authenticated
  USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());
