-- Per-user UI preferences (dashboard views, board density, column visibility).
-- Authorization truth remains in lib/services; RLS is defense in depth.

CREATE TABLE user_preference (
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  pref_key text NOT NULL,
  pref_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pref_key)
);

CREATE INDEX idx_user_preference_user ON user_preference (user_id);

ALTER TABLE user_preference ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_preference_select ON user_preference
  FOR SELECT TO authenticated
  USING (user_id = current_app_user_id());

CREATE POLICY user_preference_insert ON user_preference
  FOR INSERT TO authenticated
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY user_preference_update ON user_preference
  FOR UPDATE TO authenticated
  USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY user_preference_delete ON user_preference
  FOR DELETE TO authenticated
  USING (user_id = current_app_user_id());
