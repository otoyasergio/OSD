-- Workflow V2 phase 4/7: quantity-based parts readiness and procurement.
-- Sell prices stay technician-visible (matches current part.unit_price);
-- supplier costs live only on purchase orders (front office/admin).

CREATE TABLE IF NOT EXISTS job_part_requirement (
  requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  part_id uuid REFERENCES part(part_id) ON DELETE SET NULL,
  catalog_sku text,
  description text NOT NULL,
  part_number text,
  quantity_required numeric(10, 2) NOT NULL CHECK (quantity_required > 0),
  quantity_received numeric(10, 2) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_allocated numeric(10, 2) NOT NULL DEFAULT 0 CHECK (quantity_allocated >= 0),
  quantity_installed numeric(10, 2) NOT NULL DEFAULT 0 CHECK (quantity_installed >= 0),
  sell_price_cents bigint CHECK (sell_price_cents IS NULL OR sell_price_cents >= 0),
  included_in_package boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'planned' CHECK (
    state IN (
      'planned', 'to_order', 'ordered', 'partially_received', 'received',
      'allocated', 'installed', 'waived', 'cancelled', 'returned'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_part_requirement_job
  ON job_part_requirement (job_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_part_requirement_legacy_part
  ON job_part_requirement (part_id)
  WHERE part_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS purchase_order (
  purchase_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  supplier text NOT NULL,
  external_po_number text,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'submitted', 'partially_received', 'received', 'cancelled')
  ),
  ordered_at timestamptz,
  expected_at timestamptz,
  received_at timestamptz,
  created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_location
  ON purchase_order (location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_line (
  po_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_order(purchase_order_id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES job_part_requirement(requirement_id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity_ordered numeric(10, 2) NOT NULL CHECK (quantity_ordered > 0),
  unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_line_po
  ON purchase_order_line (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_line_requirement
  ON purchase_order_line (requirement_id) WHERE requirement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS part_receipt (
  receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_line_id uuid NOT NULL REFERENCES purchase_order_line(po_line_id) ON DELETE CASCADE,
  quantity_received numeric(10, 2) NOT NULL CHECK (quantity_received > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS part_allocation (
  allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL REFERENCES job_part_requirement(requirement_id) ON DELETE CASCADE,
  receipt_id uuid REFERENCES part_receipt(receipt_id) ON DELETE SET NULL,
  quantity numeric(10, 2) NOT NULL CHECK (quantity > 0),
  allocated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_part_allocation_requirement
  ON part_allocation (requirement_id);

-- RLS
ALTER TABLE job_part_requirement ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_allocation ENABLE ROW LEVEL SECURITY;

-- Requirements: readable by all active staff at the job's location.
DROP POLICY IF EXISTS job_part_requirement_select ON job_part_requirement;
CREATE POLICY job_part_requirement_select ON job_part_requirement
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1
      FROM job j
      JOIN work_order wo ON wo.work_order_id = j.work_order_id
      WHERE j.job_id = job_part_requirement.job_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );

-- Procurement carries supplier cost: front office/admin only.
DROP POLICY IF EXISTS purchase_order_select ON purchase_order;
CREATE POLICY purchase_order_select ON purchase_order
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS purchase_order_line_select ON purchase_order_line;
CREATE POLICY purchase_order_line_select ON purchase_order_line
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1 FROM purchase_order po
      WHERE po.purchase_order_id = purchase_order_line.purchase_order_id
        AND po.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS part_receipt_select ON part_receipt;
CREATE POLICY part_receipt_select ON part_receipt
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS part_allocation_select ON part_allocation;
CREATE POLICY part_allocation_select ON part_allocation
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1
      FROM job_part_requirement r
      JOIN job j ON j.job_id = r.job_id
      JOIN work_order wo ON wo.work_order_id = j.work_order_id
      WHERE r.requirement_id = part_allocation.requirement_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );
