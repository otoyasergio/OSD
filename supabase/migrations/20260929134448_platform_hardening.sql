-- Platform hardening after the 2026-09-29 live Supabase/Vercel audit.
-- Keep privileged helpers server-only, make webhook-event denial explicit,
-- and add only indexes backed by live application query paths.

-- Square events are written and read only by signature-verified server code
-- using the service role. RLS already denied browser access because no policy
-- existed; keep the denial explicit so future grants cannot expose payloads.
REVOKE ALL ON TABLE public.square_webhook_event FROM anon, authenticated;

DROP POLICY IF EXISTS square_webhook_event_no_client_access
  ON public.square_webhook_event;
CREATE POLICY square_webhook_event_no_client_access
  ON public.square_webhook_event
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- These helpers are implementation details of service-role workflow commands.
-- Direct Data API execution could otherwise disclose authorization state or
-- consume work-order sequence numbers.
REVOKE EXECUTE ON FUNCTION public.workflow_v2_job_authorization(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.workflow_v2_job_authorization(uuid)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.workflow_v2_job_is_authorized(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.workflow_v2_job_is_authorized(uuid)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.mint_work_order_number(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mint_work_order_number(uuid)
  FROM authenticated;

-- Wix booking ingestion is the only caller and uses the service-role client.
-- The previous auth.uid()-based guard always rejected service-role requests,
-- despite its EXECUTE grant.
CREATE OR REPLACE FUNCTION public.mint_work_order_number(p_location_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  next_value integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.location
    WHERE location_id = p_location_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'LOCATION_NOT_FOUND';
  END IF;

  INSERT INTO public.work_order_sequence (location_id, next_number)
  VALUES (p_location_id, 1001)
  ON CONFLICT (location_id) DO NOTHING;

  UPDATE public.work_order_sequence
  SET next_number = next_number + 1
  WHERE location_id = p_location_id
  RETURNING next_number - 1 INTO next_value;

  RETURN 'WO-' || next_value::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.workflow_v2_job_authorization(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_v2_job_is_authorized(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mint_work_order_number(uuid)
  TO service_role;

-- Sequence state is internal. Owners may seed a row when creating a location;
-- only the service-role mint function may read or advance counters.
REVOKE ALL ON TABLE public.work_order_sequence FROM anon, authenticated;
GRANT INSERT ON TABLE public.work_order_sequence TO authenticated;
GRANT ALL ON TABLE public.work_order_sequence TO service_role;

DROP POLICY IF EXISTS work_order_sequence_select
  ON public.work_order_sequence;
DROP POLICY IF EXISTS work_order_sequence_write
  ON public.work_order_sequence;
DROP POLICY IF EXISTS work_order_sequence_update
  ON public.work_order_sequence;
CREATE POLICY work_order_sequence_insert_owner
  ON public.work_order_sequence
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.current_app_user_role()) = 'owner');

-- Cover foreign keys used as filters/joins by current application services.
CREATE INDEX IF NOT EXISTS idx_technician_note_job_id
  ON public.technician_note (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_attachment_message_id
  ON public.chat_attachment (message_id);

CREATE INDEX IF NOT EXISTS idx_chat_call_conversation_id
  ON public.chat_call (conversation_id);

CREATE INDEX IF NOT EXISTS idx_recommendation_inspection_result_id
  ON public.recommendation (inspection_result_id)
  WHERE inspection_result_id IS NOT NULL;

-- Production already uses FULL identity for filtered notification changes.
-- Keep local, QA, and fresh projects aligned with that state.
ALTER TABLE public.staff_notification REPLICA IDENTITY FULL;
