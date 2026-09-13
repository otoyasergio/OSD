-- Workflow V2 backfill: resumable, idempotent batch migration of existing
-- rows onto the V2 facets, with checkpointing and anomaly quarantine.
-- Conservative by design: it never fabricates estimates, decisions, or
-- confirmations. Legacy-authorized jobs stay authorized through
-- workflow_v2_job_is_authorized's legacy fallback until real V2 estimates
-- exist for them.

CREATE TABLE IF NOT EXISTS workflow_v2_migration_checkpoint (
  checkpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_started_at timestamptz NOT NULL DEFAULT now(),
  batch_finished_at timestamptz,
  work_orders_processed integer NOT NULL DEFAULT 0,
  jobs_processed integer NOT NULL DEFAULT 0,
  anomalies_found integer NOT NULL DEFAULT 0,
  apply_mode boolean NOT NULL DEFAULT false,
  notes text
);

CREATE TABLE IF NOT EXISTS workflow_v2_anomaly (
  anomaly_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  work_order_id uuid,
  code text NOT NULL,
  detail jsonb,
  blocking boolean NOT NULL DEFAULT false,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (entity_type, entity_id, code)
);

ALTER TABLE workflow_v2_migration_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_v2_anomaly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_v2_checkpoint_select ON workflow_v2_migration_checkpoint;
CREATE POLICY workflow_v2_checkpoint_select ON workflow_v2_migration_checkpoint
  FOR SELECT TO authenticated
  USING (is_active_app_user() AND current_app_user_role() IN ('owner', 'manager', 'admin'));

DROP POLICY IF EXISTS workflow_v2_anomaly_select ON workflow_v2_anomaly;
CREATE POLICY workflow_v2_anomaly_select ON workflow_v2_anomaly
  FOR SELECT TO authenticated
  USING (is_active_app_user() AND current_app_user_role() IN ('owner', 'manager', 'admin'));

-- Record (or refresh) an anomaly without failing the batch.
CREATE OR REPLACE FUNCTION public.workflow_v2_record_anomaly(
  p_entity_type text,
  p_entity_id uuid,
  p_work_order_id uuid,
  p_code text,
  p_detail jsonb,
  p_blocking boolean
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO workflow_v2_anomaly (
    entity_type, entity_id, work_order_id, code, detail, blocking
  ) VALUES (
    p_entity_type, p_entity_id, p_work_order_id, p_code, p_detail, p_blocking
  )
  ON CONFLICT (entity_type, entity_id, code)
  DO UPDATE SET detail = EXCLUDED.detail, detected_at = now(), resolved_at = NULL;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_record_anomaly(text, uuid, uuid, text, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_record_anomaly(text, uuid, uuid, text, jsonb, boolean)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Batch backfill. Processes work orders whose lifecycle_state is NULL (the
-- resumability marker), row-locked, in stable order. Re-running after
-- completion processes zero rows. p_apply=false reports without writing
-- facet values (anomaly detection still records).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_v2_backfill_batch(
  p_limit integer DEFAULT 100,
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wo record;
  j record;
  wos_processed integer := 0;
  jobs_done integer := 0;
  anomalies integer := 0;
  lifecycle text;
  target_work_state text;
  target_pricing_mode text;
  price_cents bigint;
  checkpoint_id_out uuid;
BEGIN
  INSERT INTO workflow_v2_migration_checkpoint (apply_mode)
  VALUES (p_apply)
  RETURNING checkpoint_id INTO checkpoint_id_out;

  FOR wo IN
    SELECT * FROM work_order
    WHERE lifecycle_state IS NULL
    ORDER BY date_created
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    wos_processed := wos_processed + 1;

    lifecycle := CASE wo.status
      WHEN 'draft' THEN 'draft'
      WHEN 'completed' THEN 'closed'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'on_hold' THEN 'on_hold'
      ELSE 'active'
    END;

    -- Anomaly: completed WO with unpaid balance markers.
    IF wo.status = 'completed'
      AND COALESCE(wo.billing_stage, 'none') IN ('awaiting_approval', 'invoiced')
    THEN
      PERFORM public.workflow_v2_record_anomaly(
        'work_order', wo.work_order_id, wo.work_order_id,
        'CLOSED_WITH_OPEN_BILLING',
        jsonb_build_object('billing_stage', wo.billing_stage),
        false
      );
      anomalies := anomalies + 1;
    END IF;

    FOR j IN SELECT * FROM job WHERE work_order_id = wo.work_order_id LOOP
      jobs_done := jobs_done + 1;

      target_work_state := CASE j.status
        WHEN 'draft' THEN 'planned'
        WHEN 'waiting_for_approval' THEN 'planned'
        WHEN 'approved' THEN 'planned'
        WHEN 'declined' THEN 'planned'
        WHEN 'waiting_for_parts' THEN 'planned'
        WHEN 'ready_to_start' THEN 'ready'
        WHEN 'in_progress' THEN 'in_progress'
        WHEN 'completed' THEN 'completed'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE NULL
      END;

      IF target_work_state IS NULL THEN
        PERFORM public.workflow_v2_record_anomaly(
          'job', j.job_id, wo.work_order_id,
          'UNKNOWN_LEGACY_JOB_STATUS',
          jsonb_build_object('status', j.status),
          true
        );
        anomalies := anomalies + 1;
        CONTINUE;
      END IF;

      -- Legacy flat price snapshot maps onto a fixed package so invoice
      -- parity is exact. Missing snapshots become anomalies, not guesses.
      price_cents := CASE
        WHEN j.standard_price_snapshot IS NULL THEN NULL
        ELSE ROUND(j.standard_price_snapshot * 100)::bigint
      END;
      target_pricing_mode := CASE
        WHEN price_cents IS NULL THEN 'no_charge'
        ELSE 'fixed_package'
      END;
      IF price_cents IS NULL AND j.status NOT IN ('cancelled', 'declined', 'draft') THEN
        PERFORM public.workflow_v2_record_anomaly(
          'job', j.job_id, wo.work_order_id,
          'JOB_MISSING_PRICE_SNAPSHOT',
          jsonb_build_object('status', j.status),
          false
        );
        anomalies := anomalies + 1;
      END IF;

      IF p_apply THEN
        UPDATE job SET
          work_state = COALESCE(work_state, target_work_state),
          pricing_mode = COALESCE(pricing_mode, target_pricing_mode)
        WHERE job_id = j.job_id;

        -- Park state becomes an explicit blocker.
        IF j.floor_parked_at IS NOT NULL AND j.floor_park_reason IS NOT NULL THEN
          INSERT INTO job_blocker (
            job_id, location_id, kind, owner, reason, opened_at
          ) VALUES (
            j.job_id,
            wo.location_id,
            CASE WHEN j.floor_park_reason IN
              ('parts', 'approval', 'tool', 'other', 'swapped')
              THEN j.floor_park_reason ELSE 'other' END,
            CASE WHEN j.floor_wait_owner = 'technician'
              THEN 'technician' ELSE 'front_desk' END,
            'Backfilled from floor park state',
            j.floor_parked_at
          )
          ON CONFLICT DO NOTHING;
        END IF;

        -- Waiting-for-parts legacy status also implies a parts blocker.
        IF j.status = 'waiting_for_parts' THEN
          INSERT INTO job_blocker (job_id, location_id, kind, owner, reason)
          VALUES (
            j.job_id, wo.location_id, 'parts', 'front_desk',
            'Backfilled from legacy waiting_for_parts'
          )
          ON CONFLICT DO NOTHING;
        END IF;

        -- Quoted labour snapshot becomes a labour plan line (non-package).
        IF j.estimated_labour_snapshot IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM job_labor_plan WHERE job_id = j.job_id)
        THEN
          INSERT INTO job_labor_plan (
            job_id, description, estimated_minutes,
            rate_cents_per_hour_snapshot, amount_cents, billable,
            included_in_package, position
          ) VALUES (
            j.job_id,
            COALESCE(j.service_name_snapshot, 'Labour'),
            ROUND(j.estimated_labour_snapshot * 60)::integer,
            0,
            0,
            false,
            true,
            0
          );
        END IF;
      END IF;
    END LOOP;

    -- Orphaned converted recommendations are blocking anomalies.
    PERFORM public.workflow_v2_record_anomaly(
      'recommendation', r.recommendation_id, wo.work_order_id,
      'CONVERTED_RECOMMENDATION_MISSING_JOB',
      jsonb_build_object('converted_job_id', r.converted_job_id),
      true
    )
    FROM recommendation r
    WHERE r.work_order_id = wo.work_order_id
      AND r.status = 'converted_to_job'
      AND (
        r.converted_job_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM job jj WHERE jj.job_id = r.converted_job_id)
      );

    IF p_apply THEN
      UPDATE work_order SET
        lifecycle_state = lifecycle,
        service_completed_at = COALESCE(service_completed_at, completed_at),
        closed_at = COALESCE(
          closed_at,
          CASE WHEN wo.status IN ('completed', 'cancelled') THEN wo.completed_at END
        )
      WHERE work_order_id = wo.work_order_id;

      -- Durable recommendation facets from legacy status.
      UPDATE recommendation SET
        motorcycle_id = COALESCE(
          recommendation.motorcycle_id,
          (SELECT motorcycle_id FROM work_order w2
           WHERE w2.work_order_id = recommendation.work_order_id)
        ),
        disposition = COALESCE(
          recommendation.disposition,
          CASE recommendation.status
            WHEN 'pending' THEN 'open'
            WHEN 'deferred' THEN 'deferred'
            WHEN 'declined' THEN 'declined'
            WHEN 'approved' THEN 'scheduled'
            WHEN 'converted_to_job' THEN
              CASE WHEN EXISTS (
                SELECT 1 FROM job jj
                WHERE jj.job_id = recommendation.converted_job_id
                  AND jj.status = 'completed'
              ) THEN 'resolved' ELSE 'scheduled' END
            ELSE 'open'
          END
        )
      WHERE recommendation.work_order_id = wo.work_order_id;
    END IF;
  END LOOP;

  UPDATE workflow_v2_migration_checkpoint SET
    batch_finished_at = now(),
    work_orders_processed = wos_processed,
    jobs_processed = jobs_done,
    anomalies_found = anomalies
  WHERE checkpoint_id = checkpoint_id_out;

  RETURN jsonb_build_object(
    'checkpoint_id', checkpoint_id_out,
    'work_orders_processed', wos_processed,
    'jobs_processed', jobs_done,
    'anomalies_found', anomalies,
    'apply', p_apply
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_backfill_batch(integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_backfill_batch(integer, boolean)
  TO service_role;
