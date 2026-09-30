-- Phase A attendance / ESA: breaks, timesheet weeks, soft-void punches

-- Soft void instead of hard delete (Ontario retention)
ALTER TABLE time_clock_entry
  ADD COLUMN IF NOT EXISTS voided_at timestamptz;

DROP INDEX IF EXISTS uq_time_clock_open_per_user;
CREATE UNIQUE INDEX uq_time_clock_open_per_user
  ON time_clock_entry (user_id)
  WHERE clock_out_at IS NULL AND voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_clock_entry_voided
  ON time_clock_entry (location_id, clock_in_at DESC)
  WHERE voided_at IS NULL;

-- Meal / other unpaid breaks on a punch
CREATE TABLE IF NOT EXISTS time_clock_break (
  break_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES time_clock_entry(entry_id) ON DELETE CASCADE,
  break_type text NOT NULL DEFAULT 'meal'
    CHECK (break_type IN ('meal', 'other')),
  break_start_at timestamptz NOT NULL DEFAULT now(),
  break_end_at timestamptz,
  CONSTRAINT time_clock_break_end_after_start CHECK (
    break_end_at IS NULL OR break_end_at >= break_start_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_time_clock_open_break_per_entry
  ON time_clock_break (entry_id)
  WHERE break_end_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_clock_break_entry
  ON time_clock_break (entry_id, break_start_at);

ALTER TABLE time_clock_break ENABLE ROW LEVEL SECURITY;

CREATE POLICY time_clock_break_select ON time_clock_break
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM time_clock_entry e
      WHERE e.entry_id = time_clock_break.entry_id
        AND (
          e.user_id = current_app_user_id()
          OR current_app_user_role() IN ('owner', 'manager')
          OR (
            e.clock_out_at IS NULL
            AND e.voided_at IS NULL
            AND e.location_id IN (SELECT public.user_location_ids())
          )
        )
    )
  );

CREATE POLICY time_clock_break_insert ON time_clock_break
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM time_clock_entry e
      WHERE e.entry_id = time_clock_break.entry_id
        AND e.voided_at IS NULL
        AND (
          e.user_id = current_app_user_id()
          OR current_app_user_role() IN ('owner', 'manager')
        )
    )
  );

CREATE POLICY time_clock_break_update ON time_clock_break
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM time_clock_entry e
      WHERE e.entry_id = time_clock_break.entry_id
        AND (
          e.user_id = current_app_user_id()
          OR current_app_user_role() IN ('owner', 'manager')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM time_clock_entry e
      WHERE e.entry_id = time_clock_break.entry_id
        AND (
          e.user_id = current_app_user_id()
          OR current_app_user_role() IN ('owner', 'manager')
        )
    )
  );

CREATE POLICY time_clock_break_delete ON time_clock_break
  FOR DELETE TO authenticated
  USING (current_app_user_role() IN ('owner', 'manager'));

-- Weekly timesheet approval workflow
CREATE TABLE IF NOT EXISTS timesheet_week (
  timesheet_week_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  week_start_date date NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz,
  approved_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_week_user_location_week UNIQUE (user_id, location_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_week_location_week
  ON timesheet_week (location_id, week_start_date DESC);

CREATE INDEX IF NOT EXISTS idx_timesheet_week_user
  ON timesheet_week (user_id, week_start_date DESC);

ALTER TABLE timesheet_week ENABLE ROW LEVEL SECURITY;

CREATE POLICY timesheet_week_select ON timesheet_week
  FOR SELECT TO authenticated
  USING (
    user_id = current_app_user_id()
    OR current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY timesheet_week_insert ON timesheet_week
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = current_app_user_id()
    OR current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY timesheet_week_update ON timesheet_week
  FOR UPDATE TO authenticated
  USING (
    user_id = current_app_user_id()
    OR current_app_user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    user_id = current_app_user_id()
    OR current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY timesheet_week_delete ON timesheet_week
  FOR DELETE TO authenticated
  USING (current_app_user_role() IN ('owner', 'manager'));
