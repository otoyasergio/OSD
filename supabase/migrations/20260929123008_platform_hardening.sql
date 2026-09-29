-- Platform hardening after the 2026-09-29 live Supabase/Vercel audit.
-- Keep privileged helpers server-only, make webhook-event denial explicit,
-- and add only indexes backed by live application query paths.

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension extension
    JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'pg_trgm'
      AND namespace.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;
END
$$;

-- Square events are written and read only by signature-verified server code
-- using the service role. RLS already denied browser access because no policy
-- existed; keep the denial explicit so future grants cannot expose payloads.
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

GRANT EXECUTE ON FUNCTION public.workflow_v2_job_authorization(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_v2_job_is_authorized(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mint_work_order_number(uuid)
  TO service_role;

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
