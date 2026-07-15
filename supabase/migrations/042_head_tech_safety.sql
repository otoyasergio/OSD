-- Head Tech safety stage: role, WO status, safety columns.

ALTER TABLE app_user
  DROP CONSTRAINT IF EXISTS app_user_role_check;

ALTER TABLE app_user
  ADD CONSTRAINT app_user_role_check CHECK (role IN (
    'owner',
    'manager',
    'service_advisor',
    'technician',
    'head_tech',
    'admin'
  ));

ALTER TABLE work_order
  DROP CONSTRAINT IF EXISTS work_order_status_check;

ALTER TABLE work_order
  ADD CONSTRAINT work_order_status_check CHECK (status IN (
    'draft',
    'open',
    'inspection_in_progress',
    'waiting_for_customer_approval',
    'waiting_for_parts',
    'ready_for_technician',
    'in_progress',
    'quality_check',
    'safety_check',
    'ready_for_pickup',
    'completed',
    'cancelled',
    'on_hold'
  ));

ALTER TABLE work_order
  ADD COLUMN IF NOT EXISTS safety_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS safety_checked_by_user_id uuid
    REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS safety_check_notes text,
  ADD COLUMN IF NOT EXISTS safety_required boolean,
  ADD COLUMN IF NOT EXISTS safety_waived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_work_order_safety_checked_by
  ON work_order (safety_checked_by_user_id)
  WHERE safety_checked_by_user_id IS NOT NULL;
