-- Workflow V2 commands (1/2): estimate presentation and confirmation.
-- SECURITY DEFINER transactional commands are the only write path for
-- estimate documents. Every command validates the actor, locks its rows,
-- honours idempotency keys, and appends a domain event in-transaction.

-- Actor helper: resolves and validates a staff actor for definer commands.
CREATE OR REPLACE FUNCTION public.workflow_v2_require_staff_actor(
  p_actor_user_id uuid,
  p_allowed_roles text[]
)
RETURNS app_user
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor app_user;
BEGIN
  SELECT * INTO actor FROM app_user WHERE user_id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTOR_NOT_FOUND';
  END IF;
  IF actor.status <> 'active' THEN
    RAISE EXCEPTION 'ACTOR_INACTIVE';
  END IF;
  IF NOT (actor.role = ANY (p_allowed_roles)) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN actor;
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_require_staff_actor(uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_require_staff_actor(uuid, text[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- present_estimate: freeze a draft snapshot into an immutable presented
-- version (superseding any previous presented version).
-- Payload shape (built by lib/services/estimatePricing.ts):
-- {
--   "jobs": [{ "jobId", "displayOrder", "title", "description",
--              "pricingMode", "laborCents", "partsCents", "feesCents",
--              "discountCents", "taxCents", "totalCents" }],
--   "lines": [{ "kind", "jobId", "description", "quantity",
--               "unitAmountCents", "extendedAmountCents", "taxRateBps",
--               "taxAmountCents", "position" }],
--   "totals": { "subtotalCents", "discountCents", "taxCents", "totalCents" },
--   "contentHash": "..."
-- }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_v2_present_estimate(
  p_work_order_id uuid,
  p_actor_user_id uuid,
  p_payload jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor app_user;
  wo work_order;
  est estimate;
  next_version integer;
  new_version_id uuid;
  job_row jsonb;
  line_row jsonb;
  presented_job_count integer := 0;
  existing_event uuid;
BEGIN
  actor := public.workflow_v2_require_staff_actor(
    p_actor_user_id,
    ARRAY['owner', 'manager', 'service_advisor', 'admin']
  );

  IF p_idempotency_key IS NOT NULL THEN
    SELECT domain_event_id INTO existing_event
    FROM domain_event WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT jsonb_build_object(
        'estimate_id', e.estimate_id,
        'estimate_version_id', e.current_version_id,
        'replayed', true
      ) INTO STRICT p_payload
      FROM estimate e
      WHERE e.work_order_id = p_work_order_id
        AND e.status IN ('draft', 'presented', 'confirmed');
      RETURN p_payload;
    END IF;
  END IF;

  SELECT * INTO wo FROM work_order
  WHERE work_order_id = p_work_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND';
  END IF;
  IF wo.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'WORK_ORDER_LOCKED';
  END IF;

  IF COALESCE(jsonb_array_length(p_payload -> 'jobs'), 0) = 0 THEN
    RAISE EXCEPTION 'ESTIMATE_EMPTY';
  END IF;
  IF COALESCE(p_payload ->> 'contentHash', '') = '' THEN
    RAISE EXCEPTION 'ESTIMATE_CONTENT_HASH_REQUIRED';
  END IF;

  SELECT * INTO est FROM estimate
  WHERE work_order_id = p_work_order_id
    AND status IN ('draft', 'presented', 'confirmed')
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO estimate (
      work_order_id, location_id, estimate_number, status, created_by_user_id
    ) VALUES (
      p_work_order_id,
      wo.location_id,
      wo.work_order_number || '-E1',
      'draft',
      actor.user_id
    )
    RETURNING * INTO est;
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO next_version
  FROM estimate_version WHERE estimate_id = est.estimate_id;

  -- Supersede a previously presented (undecided) version.
  UPDATE estimate_version
  SET status = 'superseded'
  WHERE estimate_id = est.estimate_id AND status = 'presented';

  INSERT INTO estimate_version (
    estimate_id, version_no, status,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    content_hash, created_by_user_id
  ) VALUES (
    est.estimate_id, next_version, 'draft',
    (p_payload #>> '{totals,subtotalCents}')::bigint,
    (p_payload #>> '{totals,discountCents}')::bigint,
    (p_payload #>> '{totals,taxCents}')::bigint,
    (p_payload #>> '{totals,totalCents}')::bigint,
    p_payload ->> 'contentHash',
    actor.user_id
  )
  RETURNING estimate_version_id INTO new_version_id;

  FOR job_row IN SELECT * FROM jsonb_array_elements(p_payload -> 'jobs') LOOP
    PERFORM 1 FROM job
    WHERE job_id = (job_row ->> 'jobId')::uuid
      AND work_order_id = p_work_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ESTIMATE_JOB_NOT_ON_WORK_ORDER';
    END IF;

    INSERT INTO estimate_job (
      estimate_version_id, job_id, display_order,
      title_snapshot, description_snapshot, pricing_mode_snapshot,
      labor_cents, parts_cents, fees_cents, discount_cents, tax_cents, total_cents
    ) VALUES (
      new_version_id,
      (job_row ->> 'jobId')::uuid,
      COALESCE((job_row ->> 'displayOrder')::integer, 0),
      job_row ->> 'title',
      job_row ->> 'description',
      job_row ->> 'pricingMode',
      COALESCE((job_row ->> 'laborCents')::bigint, 0),
      COALESCE((job_row ->> 'partsCents')::bigint, 0),
      COALESCE((job_row ->> 'feesCents')::bigint, 0),
      COALESCE((job_row ->> 'discountCents')::bigint, 0),
      COALESCE((job_row ->> 'taxCents')::bigint, 0),
      COALESCE((job_row ->> 'totalCents')::bigint, 0)
    );
    presented_job_count := presented_job_count + 1;
  END LOOP;

  FOR line_row IN SELECT * FROM jsonb_array_elements(p_payload -> 'lines') LOOP
    INSERT INTO estimate_line (
      estimate_version_id, job_id, kind, description, quantity,
      unit_amount_cents, extended_amount_cents,
      tax_rate_bps, tax_amount_cents, position
    ) VALUES (
      new_version_id,
      NULLIF(line_row ->> 'jobId', '')::uuid,
      line_row ->> 'kind',
      line_row ->> 'description',
      COALESCE((line_row ->> 'quantity')::numeric, 1),
      COALESCE((line_row ->> 'unitAmountCents')::bigint, 0),
      COALESCE((line_row ->> 'extendedAmountCents')::bigint, 0),
      COALESCE((line_row ->> 'taxRateBps')::integer, 1300),
      COALESCE((line_row ->> 'taxAmountCents')::bigint, 0),
      COALESCE((line_row ->> 'position')::integer, 0)
    );
  END LOOP;

  -- Freeze: draft → presented (allowed transition in the immutability trigger).
  UPDATE estimate_version
  SET status = 'presented', presented_at = now()
  WHERE estimate_version_id = new_version_id;

  UPDATE estimate
  SET status = 'presented',
      current_version_id = new_version_id,
      presented_at = now()
  WHERE estimate_id = est.estimate_id;

  -- Dual-write legacy projection: presented undecided jobs await approval.
  UPDATE job
  SET status = 'waiting_for_approval', updated_at = now()
  WHERE work_order_id = p_work_order_id
    AND job_id IN (
      SELECT ej.job_id FROM estimate_job ej
      WHERE ej.estimate_version_id = new_version_id
    )
    AND status IN ('draft', 'waiting_for_approval');

  PERFORM public.workflow_v2_append_event(
    'estimate', est.estimate_id, p_work_order_id,
    'estimate_presented', 'staff', actor.user_id,
    NULL,
    jsonb_build_object(
      'estimate_version_id', new_version_id,
      'version_no', next_version,
      'job_count', presented_job_count,
      'total_cents', (p_payload #>> '{totals,totalCents}')::bigint,
      'content_hash', p_payload ->> 'contentHash'
    ),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'estimate_id', est.estimate_id,
    'estimate_version_id', new_version_id,
    'version_no', next_version,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_present_estimate(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_present_estimate(uuid, uuid, jsonb, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- confirm_estimate: record every per-job decision plus one aggregate
-- confirmation atomically. Idempotent replays return the original result.
-- Decisions payload: [{ "jobId", "decision" }], decisionsHash precomputed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_v2_confirm_estimate(
  p_estimate_version_id uuid,
  p_decisions jsonb,
  p_decisions_hash text,
  p_expected_content_hash text,
  p_actor_type text,
  p_actor_user_id uuid DEFAULT NULL,
  p_portal_token_id uuid DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_signer_name text DEFAULT NULL,
  p_signer_contact text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  version estimate_version;
  est estimate;
  wo_id uuid;
  decision_row jsonb;
  decided_job uuid;
  decided text;
  presented_count integer;
  decision_count integer := 0;
  existing_confirmation estimate_confirmation;
  approved_at timestamptz := now();
BEGIN
  IF p_actor_type NOT IN ('customer_portal', 'staff', 'system_migration') THEN
    RAISE EXCEPTION 'INVALID_ACTOR_TYPE';
  END IF;
  IF p_actor_type = 'staff' THEN
    PERFORM public.workflow_v2_require_staff_actor(
      p_actor_user_id,
      ARRAY['owner', 'manager', 'service_advisor', 'admin']
    );
  END IF;

  SELECT * INTO version FROM estimate_version
  WHERE estimate_version_id = p_estimate_version_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ESTIMATE_VERSION_NOT_FOUND';
  END IF;

  SELECT * INTO est FROM estimate WHERE estimate_id = version.estimate_id FOR UPDATE;
  wo_id := est.work_order_id;

  -- Idempotent replay: identical decisions against a confirmed version.
  IF version.status = 'confirmed' THEN
    SELECT * INTO existing_confirmation FROM estimate_confirmation
    WHERE estimate_version_id = p_estimate_version_id;
    IF FOUND AND existing_confirmation.decisions_hash = p_decisions_hash THEN
      RETURN jsonb_build_object(
        'confirmation_id', existing_confirmation.confirmation_id,
        'replayed', true
      );
    END IF;
    RAISE EXCEPTION 'ESTIMATE_ALREADY_CONFIRMED';
  END IF;

  IF version.status <> 'presented' THEN
    RAISE EXCEPTION 'ESTIMATE_NOT_PRESENTED';
  END IF;
  IF COALESCE(version.content_hash, '') <> COALESCE(p_expected_content_hash, '') THEN
    RAISE EXCEPTION 'ESTIMATE_CONTENT_STALE';
  END IF;

  SELECT COUNT(*) INTO presented_count
  FROM estimate_job WHERE estimate_version_id = p_estimate_version_id;

  FOR decision_row IN SELECT * FROM jsonb_array_elements(p_decisions) LOOP
    decided_job := (decision_row ->> 'jobId')::uuid;
    decided := decision_row ->> 'decision';

    IF decided NOT IN ('approved', 'declined', 'deferred') THEN
      RAISE EXCEPTION 'INVALID_DECISION';
    END IF;
    PERFORM 1 FROM estimate_job
    WHERE estimate_version_id = p_estimate_version_id AND job_id = decided_job;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DECISION_FOR_UNKNOWN_JOB';
    END IF;

    INSERT INTO estimate_job_decision (
      estimate_version_id, job_id, decision, actor_type, actor_user_id,
      method, portal_token_id, signer_name, signer_contact,
      ip_address, user_agent
    ) VALUES (
      p_estimate_version_id, decided_job, decided, p_actor_type, p_actor_user_id,
      p_method, p_portal_token_id, p_signer_name, p_signer_contact,
      p_ip_address, p_user_agent
    );
    decision_count := decision_count + 1;

    -- Dual-write legacy job projection + approval evidence fields.
    IF decided = 'approved' THEN
      UPDATE job SET
        status = 'approved',
        work_state = COALESCE(work_state, 'planned'),
        approved_by_customer_at = approved_at,
        -- Legacy check constraint has no 'portal'; portal maps to 'email'
        -- (matches the current portal service behaviour).
        approval_method = CASE
          WHEN p_method = 'portal' THEN 'email'
          WHEN p_method = 'phone' THEN 'phone'
          WHEN p_method = 'email' THEN 'email'
          WHEN p_method = 'sms' THEN 'text'
          ELSE 'in_person'
        END,
        approval_recorded_by_user_id = p_actor_user_id,
        updated_at = now()
      WHERE job_id = decided_job;
    ELSE
      UPDATE job SET
        status = 'declined',
        work_state = COALESCE(work_state, 'planned'),
        declined_at = approved_at,
        decline_reason = CASE WHEN decided = 'deferred'
          THEN 'Deferred by customer' ELSE decline_reason END,
        updated_at = now()
      WHERE job_id = decided_job;
    END IF;
  END LOOP;

  IF decision_count <> presented_count THEN
    RAISE EXCEPTION 'DECISION_MISSING';
  END IF;

  INSERT INTO estimate_confirmation (
    estimate_version_id, actor_type, actor_user_id, portal_token_id, method,
    signer_name, signer_contact, ip_address, user_agent,
    decisions_hash, content_hash, totals_snapshot
  ) VALUES (
    p_estimate_version_id, p_actor_type, p_actor_user_id, p_portal_token_id,
    p_method, p_signer_name, p_signer_contact, p_ip_address, p_user_agent,
    p_decisions_hash, version.content_hash,
    jsonb_build_object(
      'subtotal_cents', version.subtotal_cents,
      'discount_cents', version.discount_cents,
      'tax_cents', version.tax_cents,
      'total_cents', version.total_cents
    )
  );

  UPDATE estimate_version
  SET status = 'confirmed', finalized_at = now()
  WHERE estimate_version_id = p_estimate_version_id;

  UPDATE estimate
  SET status = 'confirmed', confirmed_at = now()
  WHERE estimate_id = version.estimate_id;

  PERFORM public.workflow_v2_append_event(
    'estimate', version.estimate_id, wo_id,
    'estimate_confirmed',
    CASE WHEN p_actor_type = 'customer_portal' THEN 'customer' ELSE 'staff' END,
    p_actor_user_id,
    NULL,
    jsonb_build_object(
      'estimate_version_id', p_estimate_version_id,
      'decisions', p_decisions,
      'decisions_hash', p_decisions_hash
    ),
    p_idempotency_key,
    NULL,
    p_portal_token_id
  );

  RETURN jsonb_build_object(
    'confirmation_id', (
      SELECT confirmation_id FROM estimate_confirmation
      WHERE estimate_version_id = p_estimate_version_id
    ),
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_confirm_estimate(
  uuid, jsonb, text, text, text, uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_confirm_estimate(
  uuid, jsonb, text, text, text, uuid, uuid, text, text, text, text, text, text
) TO service_role;
