-- Owner-readable UX friction / user-visible error events.
CREATE TABLE IF NOT EXISTS ux_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  location_id uuid REFERENCES location (location_id) ON DELETE SET NULL,
  role text,
  source text NOT NULL DEFAULT '',
  event_type text NOT NULL CHECK (event_type IN ('user_error', 'action_failed', 'friction')),
  code text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ux_event_created_at ON ux_event (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ux_event_code ON ux_event (code);
CREATE INDEX IF NOT EXISTS idx_ux_event_actor ON ux_event (actor_user_id);

ALTER TABLE ux_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ux_event_select_owner ON ux_event;
CREATE POLICY ux_event_select_owner ON ux_event
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() = 'owner'
  );

DROP POLICY IF EXISTS ux_event_insert_self ON ux_event;
CREATE POLICY ux_event_insert_self ON ux_event
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND (
      actor_user_id IS NULL
      OR actor_user_id = current_app_user_id()
    )
  );
