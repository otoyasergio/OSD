-- Workflow V2 phase 7/7: append-only domain events and the derived
-- work-order rollup projection (facet counts + primary display stage).

CREATE TABLE IF NOT EXISTS domain_event (
  domain_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  work_order_id uuid REFERENCES work_order(work_order_id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('staff', 'customer', 'system', 'webhook')),
  actor_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  portal_token_id uuid,
  correlation_id uuid,
  idempotency_key text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_event_idempotency
  ON domain_event (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_domain_event_aggregate
  ON domain_event (aggregate_type, aggregate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_event_work_order
  ON domain_event (work_order_id, created_at DESC)
  WHERE work_order_id IS NOT NULL;

ALTER TABLE domain_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS domain_event_select ON domain_event;
CREATE POLICY domain_event_select ON domain_event
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'admin')
  );

DROP TRIGGER IF EXISTS trg_domain_event_append_only ON domain_event;
CREATE TRIGGER trg_domain_event_append_only
  BEFORE UPDATE OR DELETE ON domain_event
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();

-- Trusted append helper used inside SECURITY DEFINER commands. Returns the
-- existing event id when the idempotency key was already consumed.
CREATE OR REPLACE FUNCTION public.workflow_v2_append_event(
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_work_order_id uuid,
  p_event_type text,
  p_actor_type text,
  p_actor_user_id uuid,
  p_old_value jsonb,
  p_new_value jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_portal_token_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_id uuid;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT domain_event_id INTO event_id
    FROM domain_event
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN event_id;
    END IF;
  END IF;

  INSERT INTO domain_event (
    aggregate_type, aggregate_id, work_order_id, event_type,
    actor_type, actor_user_id, portal_token_id, correlation_id,
    idempotency_key, old_value, new_value
  ) VALUES (
    p_aggregate_type, p_aggregate_id, p_work_order_id, p_event_type,
    p_actor_type, p_actor_user_id, p_portal_token_id, p_correlation_id,
    p_idempotency_key, p_old_value, p_new_value
  )
  RETURNING domain_event_id INTO event_id;

  RETURN event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_append_event(
  text, uuid, uuid, text, text, uuid, jsonb, jsonb, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_append_event(
  text, uuid, uuid, text, text, uuid, jsonb, jsonb, text, uuid, uuid
) TO service_role;

-- Rollup projection: facet counts per work order. display_stage mirrors
-- lib/jobs-v2/rollup.ts; the TS module is the tested source of the rules.
CREATE OR REPLACE VIEW work_order_rollup_v2
WITH (security_invoker = true)
AS
SELECT
  wo.work_order_id,
  wo.location_id,
  wo.lifecycle_state,
  wo.status AS legacy_status,
  COUNT(*) FILTER (
    WHERE ej.job_id IS NOT NULL AND d.decision_id IS NULL
  ) AS pending_decision_count,
  COUNT(*) FILTER (WHERE d.decision = 'approved') AS approved_job_count,
  COUNT(*) FILTER (WHERE d.decision = 'declined') AS declined_job_count,
  COUNT(*) FILTER (
    WHERE j.work_state IN ('planned', 'ready')
      AND EXISTS (
        SELECT 1 FROM job_blocker b
        WHERE b.job_id = j.job_id AND b.kind = 'parts' AND b.cleared_at IS NULL
      )
  ) AS waiting_parts_count,
  COUNT(*) FILTER (WHERE j.work_state = 'ready') AS ready_job_count,
  COUNT(*) FILTER (WHERE j.work_state = 'in_progress') AS in_progress_count,
  COUNT(*) FILTER (WHERE j.work_state = 'completed') AS completed_job_count,
  COUNT(*) FILTER (WHERE j.work_state = 'cancelled') AS cancelled_job_count,
  COALESCE(
    (
      SELECT SUM(i.balance_cents)
      FROM invoice i
      WHERE i.work_order_id = wo.work_order_id
        AND i.status IN ('issued', 'partially_paid')
    ), 0
  ) AS invoice_balance_cents
FROM work_order wo
LEFT JOIN job j
  ON j.work_order_id = wo.work_order_id
LEFT JOIN LATERAL (
  SELECT ej.job_id
  FROM estimate_job ej
  JOIN estimate_version ev ON ev.estimate_version_id = ej.estimate_version_id
  WHERE ej.job_id = j.job_id AND ev.status IN ('presented', 'confirmed')
  ORDER BY ev.version_no DESC
  LIMIT 1
) ej ON true
LEFT JOIN LATERAL (
  SELECT dcs.decision_id, dcs.decision
  FROM estimate_job_decision dcs
  JOIN estimate_version ev ON ev.estimate_version_id = dcs.estimate_version_id
  WHERE dcs.job_id = j.job_id AND ev.status IN ('presented', 'confirmed')
  ORDER BY dcs.decided_at DESC
  LIMIT 1
) d ON true
GROUP BY wo.work_order_id, wo.location_id, wo.lifecycle_state, wo.status;
