-- Workflow V2 phase 2/7: versioned service catalogue, labour rates, and
-- per-job labour plans (hybrid itemized / fixed-package pricing).

CREATE TABLE IF NOT EXISTS service_version (
  service_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES service(service_id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  name_snapshot text NOT NULL,
  category_snapshot text,
  pricing_mode text NOT NULL DEFAULT 'fixed_package' CHECK (
    pricing_mode IN ('itemized', 'fixed_package', 'no_charge')
  ),
  default_labor_minutes integer CHECK (
    default_labor_minutes IS NULL OR default_labor_minutes >= 0
  ),
  fixed_package_price_cents bigint CHECK (
    fixed_package_price_cents IS NULL OR fixed_package_price_cents >= 0
  ),
  tax_code text NOT NULL DEFAULT 'HST',
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  UNIQUE (service_id, version_no)
);

-- One active version per service.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_version_active
  ON service_version (service_id)
  WHERE active;

CREATE TABLE IF NOT EXISTS service_package_component (
  component_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_version_id uuid NOT NULL REFERENCES service_version(service_version_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('labor', 'part', 'fee')),
  description text NOT NULL,
  quantity numeric(10, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  default_minutes integer CHECK (default_minutes IS NULL OR default_minutes >= 0),
  included_in_package boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_service_package_component_version
  ON service_package_component (service_version_id, position);

CREATE TABLE IF NOT EXISTS labour_rate (
  labour_rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  rate_cents_per_hour bigint NOT NULL CHECK (rate_cents_per_hour > 0),
  tax_code text NOT NULL DEFAULT 'HST',
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_labour_rate_active_code
  ON labour_rate (location_id, code)
  WHERE active;

CREATE TABLE IF NOT EXISTS job_labor_plan (
  job_labor_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  description text NOT NULL,
  estimated_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
  labour_rate_id uuid REFERENCES labour_rate(labour_rate_id) ON DELETE SET NULL,
  rate_cents_per_hour_snapshot bigint NOT NULL DEFAULT 0 CHECK (
    rate_cents_per_hour_snapshot >= 0
  ),
  amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  billable boolean NOT NULL DEFAULT true,
  included_in_package boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_labor_plan_job
  ON job_labor_plan (job_id, position);

-- RLS: catalogue readable by all active staff; labour rates and labor plans
-- carry pricing, so technician roles cannot read them. Writes only through
-- SECURITY DEFINER commands / service role.
ALTER TABLE service_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_package_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_labor_plan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_version_select ON service_version;
CREATE POLICY service_version_select ON service_version
  FOR SELECT TO authenticated
  USING (is_active_app_user());

DROP POLICY IF EXISTS service_package_component_select ON service_package_component;
CREATE POLICY service_package_component_select ON service_package_component
  FOR SELECT TO authenticated
  USING (is_active_app_user());

DROP POLICY IF EXISTS labour_rate_select ON labour_rate;
CREATE POLICY labour_rate_select ON labour_rate
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS job_labor_plan_select ON job_labor_plan;
CREATE POLICY job_labor_plan_select ON job_labor_plan
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1
      FROM job j
      JOIN work_order wo ON wo.work_order_id = j.work_order_id
      WHERE j.job_id = job_labor_plan.job_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );
