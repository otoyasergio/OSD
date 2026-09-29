-- Atomic, service-role-only lifecycle commands for Ask OTOMOTO.
-- Generated with `supabase migration new ask_otomoto_atomic_lifecycle`.

ALTER TABLE public.ai_assistant_message
  ADD COLUMN parent_user_message_id uuid
    REFERENCES public.ai_assistant_message(ai_assistant_message_id)
    ON DELETE CASCADE,
  ADD COLUMN requested_provider_model text,
  ADD COLUMN generation_attempt_id uuid;

CREATE UNIQUE INDEX uq_ai_assistant_message_parent_user
  ON public.ai_assistant_message (parent_user_message_id)
  WHERE parent_user_message_id IS NOT NULL;

CREATE FUNCTION private.ai_assistant_validate_parent_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_thread_id uuid;
  parent_role text;
  parent_status text;
BEGIN
  IF NEW.parent_user_message_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.role <> 'assistant' THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_PARENT_REQUIRES_ASSISTANT';
  END IF;

  SELECT parent.thread_id, parent.role, parent.generation_status
  INTO parent_thread_id, parent_role, parent_status
  FROM public.ai_assistant_message AS parent
  WHERE parent.ai_assistant_message_id = NEW.parent_user_message_id;

  IF NOT FOUND
    OR parent_thread_id IS DISTINCT FROM NEW.thread_id
    OR parent_role <> 'user'
    OR parent_status <> 'ready'
  THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_PARENT_USER_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ai_assistant_validate_parent_user()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_assistant_message_parent_guard
  BEFORE INSERT OR UPDATE OF parent_user_message_id, thread_id, role
  ON public.ai_assistant_message
  FOR EACH ROW
  EXECUTE FUNCTION private.ai_assistant_validate_parent_user();

CREATE FUNCTION private.ai_assistant_reject_parent_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.parent_user_message_id IS DISTINCT FROM OLD.parent_user_message_id THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_PARENT_USER_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ai_assistant_reject_parent_change()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_assistant_message_parent_immutable
  BEFORE UPDATE OF parent_user_message_id
  ON public.ai_assistant_message
  FOR EACH ROW
  EXECUTE FUNCTION private.ai_assistant_reject_parent_change();

CREATE FUNCTION private.ai_assistant_validate_promoted_note_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_job_id uuid;
BEGIN
  IF NEW.source_ai_message_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.note_type NOT IN (
    'general',
    'diagnostic_finding',
    'customer_concern_confirmed',
    'customer_concern_not_found',
    'parts_issue',
    'internal_warning'
  ) THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_NOTE_TYPE_NOT_ALLOWED';
  END IF;

  SELECT thread.job_id
  INTO source_job_id
  FROM public.ai_assistant_message AS message
  JOIN public.ai_assistant_thread AS thread
    ON thread.ai_assistant_thread_id = message.thread_id
  WHERE message.ai_assistant_message_id = NEW.source_ai_message_id;

  IF FOUND
    AND source_job_id IS NOT NULL
    AND NEW.job_id IS DISTINCT FROM source_job_id
  THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_NOTE_JOB_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ai_assistant_validate_promoted_note_policy()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER technician_note_ai_promotion_policy
  BEFORE INSERT OR UPDATE OF source_ai_message_id, note_type, job_id
  ON public.technician_note
  FOR EACH ROW
  EXECUTE FUNCTION private.ai_assistant_validate_promoted_note_policy();

CREATE FUNCTION public.ask_otomoto_begin_turn(
  p_thread_id uuid,
  p_work_order_id uuid,
  p_user_id uuid,
  p_body text,
  p_photos jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(
  user_message_id uuid,
  assistant_message_id uuid,
  generation_attempt_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  thread_status text;
  work_order_status text;
  photo_count integer;
  distinct_photo_count integer;
  v_user_message_id uuid := gen_random_uuid();
  v_assistant_message_id uuid := gen_random_uuid();
  v_generation_attempt_id uuid := gen_random_uuid();
  v_user_created_at timestamptz := clock_timestamp();
  v_assistant_created_at timestamptz;
BEGIN
  v_assistant_created_at := v_user_created_at + interval '1 microsecond';
  IF COALESCE(length(btrim(p_body)), 0) = 0 OR length(p_body) > 8000 THEN
    RAISE EXCEPTION 'DIAGNOSTICS_AI_MESSAGE_INVALID';
  END IF;
  IF jsonb_typeof(COALESCE(p_photos, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'DIAGNOSTICS_IMAGE_SELECTION_INVALID';
  END IF;

  SELECT count(*)::integer, count(DISTINCT photo.photo_id)::integer
  INTO photo_count, distinct_photo_count
  FROM jsonb_to_recordset(COALESCE(p_photos, '[]'::jsonb))
    AS photo(photo_id uuid, purpose text, sort_order integer);

  IF photo_count > 3 THEN
    RAISE EXCEPTION 'DIAGNOSTICS_IMAGE_SELECTION_LIMIT';
  END IF;
  IF photo_count <> distinct_photo_count THEN
    RAISE EXCEPTION 'DIAGNOSTICS_IMAGE_DUPLICATE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_photos, '[]'::jsonb))
      AS selected(photo_id uuid, purpose text, sort_order integer)
    LEFT JOIN public.intake_photo AS photo
      ON photo.photo_id = selected.photo_id
    WHERE photo.photo_id IS NULL
      OR photo.work_order_id IS DISTINCT FROM p_work_order_id
      OR photo.category NOT IN (
        'inspection_tires',
        'inspection_brakes',
        'inspection_forks',
        'inspection_item',
        'job_work',
        'job_proof'
      )
      OR COALESCE(length(btrim(selected.purpose)), 0) = 0
      OR length(selected.purpose) > 500
      OR selected.sort_order < 0
  ) THEN
    RAISE EXCEPTION 'DIAGNOSTICS_IMAGE_SELECTION_INVALID';
  END IF;

  SELECT thread.status, work_order.status
  INTO thread_status, work_order_status
  FROM public.ai_assistant_thread AS thread
  JOIN public.work_order AS work_order
    ON work_order.work_order_id = thread.work_order_id
  WHERE thread.ai_assistant_thread_id = p_thread_id
    AND thread.work_order_id = p_work_order_id
  FOR UPDATE OF thread;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_THREAD_NOT_FOUND';
  END IF;
  IF work_order_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'WORK_ORDER_LOCKED';
  END IF;
  IF thread_status = 'archived' THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_THREAD_ARCHIVED';
  END IF;
  IF thread_status = 'generating' THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_THREAD_BUSY';
  END IF;
  IF thread_status NOT IN ('pending', 'ready', 'failed') THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_THREAD_NOT_WRITABLE';
  END IF;

  UPDATE public.ai_assistant_thread
  SET status = 'generating', updated_at = clock_timestamp()
  WHERE ai_assistant_thread_id = p_thread_id;

  INSERT INTO public.ai_assistant_message (
    ai_assistant_message_id,
    thread_id,
    role,
    body,
    generation_status,
    created_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_user_message_id,
    p_thread_id,
    'user',
    btrim(p_body),
    'ready',
    p_user_id,
    v_user_created_at,
    v_user_created_at
  );

  INSERT INTO public.ai_assistant_message_photo (
    message_id, photo_id, sort_order, purpose
  )
  SELECT
    v_user_message_id,
    selected.photo_id,
    selected.sort_order,
    btrim(selected.purpose)
  FROM jsonb_to_recordset(COALESCE(p_photos, '[]'::jsonb))
    AS selected(photo_id uuid, purpose text, sort_order integer)
  ORDER BY selected.sort_order;

  INSERT INTO public.ai_assistant_message (
    ai_assistant_message_id,
    thread_id,
    role,
    generation_status,
    parent_user_message_id,
    generation_attempt_id,
    created_at,
    updated_at
  ) VALUES (
    v_assistant_message_id,
    p_thread_id,
    'assistant',
    'generating',
    v_user_message_id,
    v_generation_attempt_id,
    v_assistant_created_at,
    v_assistant_created_at
  );

  RETURN QUERY
  SELECT v_user_message_id, v_assistant_message_id, v_generation_attempt_id;
END;
$$;

CREATE FUNCTION public.ask_otomoto_complete_turn(
  p_thread_id uuid,
  p_assistant_message_id uuid,
  p_generation_attempt_id uuid,
  p_body text,
  p_requested_input jsonb,
  p_phase text,
  p_requested_provider_model text,
  p_resolved_provider_model text,
  p_provider_response_id text,
  p_prompt_version text,
  p_input_token_count integer,
  p_output_token_count integer,
  p_context_as_of timestamptz,
  p_context_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.ai_assistant_message
  SET
    body = p_body,
    generation_status = 'ready',
    requested_input = p_requested_input,
    phase = p_phase,
    requested_provider_model = p_requested_provider_model,
    provider_model = p_resolved_provider_model,
    provider_response_id = p_provider_response_id,
    prompt_version = p_prompt_version,
    input_token_count = p_input_token_count,
    output_token_count = p_output_token_count,
    context_as_of = p_context_as_of,
    context_hash = p_context_hash,
    safe_error_code = null,
    updated_at = clock_timestamp()
  WHERE ai_assistant_message_id = p_assistant_message_id
    AND thread_id = p_thread_id
    AND role = 'assistant'
    AND generation_status = 'generating'
    AND generation_attempt_id = p_generation_attempt_id
    AND parent_user_message_id IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_COMPLETE_CONFLICT';
  END IF;

  UPDATE public.ai_assistant_thread
  SET
    status = 'ready',
    diagnostic_phase = p_phase,
    updated_at = clock_timestamp()
  WHERE ai_assistant_thread_id = p_thread_id
    AND status = 'generating';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_COMPLETE_CONFLICT';
  END IF;
END;
$$;

CREATE FUNCTION public.ask_otomoto_fail_turn(
  p_thread_id uuid,
  p_assistant_message_id uuid,
  p_generation_attempt_id uuid,
  p_safe_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected integer;
BEGIN
  IF p_safe_error_code IS NULL
    OR p_safe_error_code !~ '^[A-Z][A-Z0-9_]*$'
    OR length(p_safe_error_code) > 120
  THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_SAFE_ERROR_INVALID';
  END IF;

  UPDATE public.ai_assistant_message
  SET
    body = null,
    generation_status = 'failed',
    safe_error_code = p_safe_error_code,
    updated_at = clock_timestamp()
  WHERE ai_assistant_message_id = p_assistant_message_id
    AND thread_id = p_thread_id
    AND role = 'assistant'
    AND generation_status = 'generating'
    AND generation_attempt_id = p_generation_attempt_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.ai_assistant_thread
  SET status = 'failed', updated_at = clock_timestamp()
  WHERE ai_assistant_thread_id = p_thread_id
    AND status = 'generating';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_FAIL_CONFLICT';
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION public.ask_otomoto_claim_retry(
  p_thread_id uuid,
  p_work_order_id uuid,
  p_stale_before timestamptz
)
RETURNS TABLE(
  user_message_id uuid,
  assistant_message_id uuid,
  generation_attempt_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  thread_status text;
  work_order_status text;
  latest_message public.ai_assistant_message%ROWTYPE;
  v_generation_attempt_id uuid := gen_random_uuid();
BEGIN
  SELECT thread.status, work_order.status
  INTO thread_status, work_order_status
  FROM public.ai_assistant_thread AS thread
  JOIN public.work_order AS work_order
    ON work_order.work_order_id = thread.work_order_id
  WHERE thread.ai_assistant_thread_id = p_thread_id
    AND thread.work_order_id = p_work_order_id
  FOR UPDATE OF thread;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_THREAD_NOT_FOUND';
  END IF;
  IF work_order_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'WORK_ORDER_LOCKED';
  END IF;
  IF thread_status = 'archived' THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_THREAD_ARCHIVED';
  END IF;

  SELECT message.*
  INTO latest_message
  FROM public.ai_assistant_message AS message
  WHERE message.thread_id = p_thread_id
  ORDER BY message.created_at DESC, message.ai_assistant_message_id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND
    OR latest_message.role <> 'assistant'
    OR latest_message.parent_user_message_id IS NULL
    OR NOT (
      latest_message.generation_status = 'failed'
      OR (
        latest_message.generation_status = 'generating'
        AND latest_message.updated_at < p_stale_before
      )
    )
  THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_RETRY_NOT_FOUND';
  END IF;

  UPDATE public.ai_assistant_message
  SET
    body = null,
    generation_status = 'generating',
    generation_attempt_id = v_generation_attempt_id,
    safe_error_code = null,
    updated_at = clock_timestamp()
  WHERE ai_assistant_message_id = latest_message.ai_assistant_message_id
    AND thread_id = p_thread_id
    AND (
      generation_status = 'failed'
      OR (
        generation_status = 'generating'
        AND updated_at < p_stale_before
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_RETRY_NOT_FOUND';
  END IF;

  UPDATE public.ai_assistant_thread
  SET status = 'generating', updated_at = clock_timestamp()
  WHERE ai_assistant_thread_id = p_thread_id
    AND status <> 'archived';

  RETURN QUERY
  SELECT
    latest_message.parent_user_message_id,
    latest_message.ai_assistant_message_id,
    v_generation_attempt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ask_otomoto_begin_turn(
  uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ask_otomoto_complete_turn(
  uuid, uuid, uuid, text, jsonb, text, text, text, text, text,
  integer, integer, timestamptz, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ask_otomoto_fail_turn(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ask_otomoto_claim_retry(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ask_otomoto_begin_turn(
  uuid, uuid, uuid, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.ask_otomoto_complete_turn(
  uuid, uuid, uuid, text, jsonb, text, text, text, text, text,
  integer, integer, timestamptz, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.ask_otomoto_fail_turn(
  uuid, uuid, uuid, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.ask_otomoto_claim_retry(
  uuid, uuid, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.ask_otomoto_begin_turn(
  uuid, uuid, uuid, text, jsonb
) IS 'Atomically claims a thread and creates one explicit Ask OTOMOTO user/assistant turn.';
COMMENT ON FUNCTION public.ask_otomoto_complete_turn(
  uuid, uuid, uuid, text, jsonb, text, text, text, text, text,
  integer, integer, timestamptz, text
) IS 'CAS-completes a generating Ask OTOMOTO response and readies its thread.';
COMMENT ON FUNCTION public.ask_otomoto_fail_turn(
  uuid, uuid, uuid, text
) IS 'CAS-fails a generating Ask OTOMOTO response without overwriting ready output.';
COMMENT ON FUNCTION public.ask_otomoto_claim_retry(
  uuid, uuid, timestamptz
) IS 'Claims only the latest failed or stale-generating Ask OTOMOTO assistant turn.';
