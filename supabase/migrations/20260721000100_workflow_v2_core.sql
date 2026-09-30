-- Workflow V2 phase 1/7: core visit + job facets, findings, durable
-- recommendations, and job blockers. Purely additive — legacy columns and
-- statuses keep working; V2 columns stay NULL until dual-write/backfill.

-- 1. Work order: lifecycle facet separated from the derived board stage.
ALTER TABLE work_order
  ADD COLUMN IF NOT EXISTS workflow_model_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lifecycle_state text,
  ADD COLUMN IF NOT EXISTS lock_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE work_order
  DROP CONSTRAINT IF EXISTS work_order_lifecycle_state_check;
ALTER TABLE work_order
  ADD CONSTRAINT work_order_lifecycle_state_check CHECK (
    lifecycle_state IS NULL
    OR lifecycle_state IN ('draft', 'active', 'on_hold', 'closed', 'cancelled')
  );

-- 2. Job: separate work-progress + pricing facets (authorization lives on
-- estimate_job_decision, never on the job row).
ALTER TABLE job
  ADD COLUMN IF NOT EXISTS work_state text,
  ADD COLUMN IF NOT EXISTS pricing_mode text,
  ADD COLUMN IF NOT EXISTS lock_version integer NOT NULL DEFAULT 0;

ALTER TABLE job
  DROP CONSTRAINT IF EXISTS job_work_state_check;
ALTER TABLE job
  ADD CONSTRAINT job_work_state_check CHECK (
    work_state IS NULL
    OR work_state IN ('planned', 'ready', 'in_progress', 'completed', 'cancelled')
  );

ALTER TABLE job
  DROP CONSTRAINT IF EXISTS job_pricing_mode_check;
ALTER TABLE job
  ADD CONSTRAINT job_pricing_mode_check CHECK (
    pricing_mode IS NULL
    OR pricing_mode IN ('itemized', 'fixed_package', 'no_charge')
  );

-- 3. Durable inspection findings (immutable evidence; withdrawal voids).
CREATE TABLE IF NOT EXISTS service_finding (
  finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motorcycle_id uuid NOT NULL REFERENCES motorcycle(motorcycle_id) ON DELETE CASCADE,
  source_work_order_id uuid REFERENCES work_order(work_order_id) ON DELETE SET NULL,
  inspection_result_id uuid REFERENCES inspection_result(inspection_result_id) ON DELETE SET NULL,
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  description text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('advisory', 'immediate', 'safety_critical')),
  notes text,
  found_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  found_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  withdrawn_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL
);

-- One live finding per inspection result (withdrawn rows do not block re-flagging).
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_finding_open_inspection_result
  ON service_finding (inspection_result_id)
  WHERE inspection_result_id IS NOT NULL AND withdrawn_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_finding_motorcycle
  ON service_finding (motorcycle_id, found_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_finding_work_order
  ON service_finding (source_work_order_id);

-- 4. Recommendation becomes durable motorcycle history (additive columns).
ALTER TABLE recommendation
  ADD COLUMN IF NOT EXISTS motorcycle_id uuid REFERENCES motorcycle(motorcycle_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finding_id uuid REFERENCES service_finding(finding_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disposition text,
  ADD COLUMN IF NOT EXISTS deferred_until date,
  ADD COLUMN IF NOT EXISTS deferred_until_odometer integer,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text;

ALTER TABLE recommendation
  DROP CONSTRAINT IF EXISTS recommendation_disposition_check;
ALTER TABLE recommendation
  ADD CONSTRAINT recommendation_disposition_check CHECK (
    disposition IS NULL
    OR disposition IN ('open', 'deferred', 'declined', 'scheduled', 'resolved', 'void')
  );

CREATE INDEX IF NOT EXISTS idx_recommendation_motorcycle
  ON recommendation (motorcycle_id) WHERE motorcycle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recommendation_disposition
  ON recommendation (disposition) WHERE disposition IS NOT NULL;

-- 5. Many-to-many: one job can address several findings and vice versa.
CREATE TABLE IF NOT EXISTS job_recommendation (
  job_id uuid NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  recommendation_id uuid NOT NULL REFERENCES recommendation(recommendation_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, recommendation_id)
);

-- 6. Explicit job blockers replace hidden park/pause secondary lifecycles.
CREATE TABLE IF NOT EXISTS job_blocker (
  job_blocker_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (
    kind IN ('parts', 'approval', 'tool', 'other', 'swapped', 'work_order_hold')
  ),
  owner text NOT NULL CHECK (owner IN ('front_desk', 'technician', 'parts', 'qc')),
  reason text,
  opened_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_blocker_open_kind
  ON job_blocker (job_id, kind)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_blocker_job ON job_blocker (job_id);

-- RLS: reads for active staff at the location; ALL writes flow through
-- SECURITY DEFINER commands or the service role (no client write policies).
ALTER TABLE service_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_blocker ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_finding_select ON service_finding;
CREATE POLICY service_finding_select ON service_finding
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS job_recommendation_select ON job_recommendation;
CREATE POLICY job_recommendation_select ON job_recommendation
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1
      FROM job j
      JOIN work_order wo ON wo.work_order_id = j.work_order_id
      WHERE j.job_id = job_recommendation.job_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS job_blocker_select ON job_blocker;
CREATE POLICY job_blocker_select ON job_blocker
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );
