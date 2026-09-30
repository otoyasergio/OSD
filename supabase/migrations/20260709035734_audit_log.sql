CREATE TABLE audit_log (
    audit_log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    location_id uuid REFERENCES location(location_id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    description text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_actor_user_id ON audit_log(actor_user_id);
CREATE INDEX idx_audit_log_location_id ON audit_log(location_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
