-- One-shot atomic claim for server-created trigger threads.
-- Generated with `supabase migration new ask_otomoto_atomic_seed_begin`.

CREATE OR REPLACE FUNCTION public.ask_otomoto_begin_seed_turn(
  p_thread_id uuid,
  p_work_order_id uuid,
  p_trigger_type text,
  p_trigger_entity_id uuid,
  p_user_id uuid,
  p_body text
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
  v_user_message_id uuid := gen_random_uuid();
  v_assistant_message_id uuid := gen_random_uuid();
  v_generation_attempt_id uuid := gen_random_uuid();
  v_user_created_at timestamptz := clock_timestamp();
  v_assistant_created_at timestamptz;
BEGIN
  IF COALESCE(length(btrim(p_body)), 0) = 0 OR length(p_body) > 8000 THEN
    RAISE EXCEPTION 'DIAGNOSTICS_AI_MESSAGE_INVALID';
  END IF;

  SELECT thread.status, work_order.status
  INTO thread_status, work_order_status
  FROM public.ai_assistant_thread AS thread
  JOIN public.work_order AS work_order
    ON work_order.work_order_id = thread.work_order_id
  WHERE thread.ai_assistant_thread_id = p_thread_id
    AND thread.work_order_id = p_work_order_id
    AND thread.trigger_type = p_trigger_type
    AND thread.trigger_entity_id = p_trigger_entity_id
    AND thread.created_by_user_id = p_user_id
  FOR UPDATE OF thread;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH';
  END IF;
  IF work_order_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'WORK_ORDER_LOCKED';
  END IF;
  IF thread_status <> 'pending'
    OR EXISTS (
      SELECT 1
      FROM public.ai_assistant_message AS message
      WHERE message.thread_id = p_thread_id
    )
  THEN
    RAISE EXCEPTION 'ASK_OTOMOTO_SEED_ALREADY_CLAIMED';
  END IF;

  v_assistant_created_at := v_user_created_at + interval '1 microsecond';

  UPDATE public.ai_assistant_thread
  SET status = 'generating', updated_at = clock_timestamp()
  WHERE ai_assistant_thread_id = p_thread_id
    AND status = 'pending';

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

REVOKE ALL ON FUNCTION public.ask_otomoto_begin_seed_turn(
  uuid, uuid, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ask_otomoto_begin_seed_turn(
  uuid, uuid, text, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION public.ask_otomoto_begin_seed_turn(
  uuid, uuid, text, uuid, uuid, text
) IS 'Atomically creates the only seed message pair for an exact pending trigger thread.';
