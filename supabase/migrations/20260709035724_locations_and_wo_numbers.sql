CREATE TABLE location (
    location_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    code text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_location (
    user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, location_id)
);

CREATE TABLE work_order_sequence (
    location_id uuid PRIMARY KEY REFERENCES location(location_id) ON DELETE CASCADE,
    next_number integer NOT NULL DEFAULT 1001
);

ALTER TABLE work_order
    ADD COLUMN location_id uuid REFERENCES location(location_id) ON DELETE RESTRICT,
    ADD COLUMN work_order_number text;

-- Greenfield: enforce NOT NULL immediately after columns are added.
-- (No legacy rows exist in V1 empty DB.)
ALTER TABLE work_order
    ALTER COLUMN location_id SET NOT NULL,
    ALTER COLUMN work_order_number SET NOT NULL;

CREATE UNIQUE INDEX uq_work_order_location_number
    ON work_order (location_id, work_order_number);

CREATE INDEX idx_work_order_location_id ON work_order(location_id);
CREATE INDEX idx_user_location_location_id ON user_location(location_id);
