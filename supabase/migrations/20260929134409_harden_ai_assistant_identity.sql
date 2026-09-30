-- Keep persisted assistant authorization and message identity stable after
-- creation. Lifecycle RPCs may update status/content metadata, but they never
-- need to rewrite these scope-defining fields.

CREATE OR REPLACE FUNCTION private.ai_assistant_reject_thread_reparent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.mode IS DISTINCT FROM OLD.mode
    OR NEW.audience IS DISTINCT FROM OLD.audience
  THEN
    RAISE EXCEPTION 'AI_ASSISTANT_THREAD_SCOPE_IMMUTABLE';
  END IF;

  IF NEW.job_id IS DISTINCT FROM OLD.job_id
    AND NOT (
      NEW.job_id IS NULL
      AND OLD.job_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.job AS deleted_job
        WHERE deleted_job.job_id = OLD.job_id
          AND deleted_job.work_order_id = OLD.work_order_id
      )
    )
  THEN
    RAISE EXCEPTION 'AI_ASSISTANT_THREAD_SCOPE_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ai_assistant_reject_thread_reparent()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ai_assistant_thread_reparent_guard
  ON public.ai_assistant_thread;
CREATE TRIGGER ai_assistant_thread_reparent_guard
  BEFORE UPDATE OF work_order_id, job_id, location_id, mode, audience
  ON public.ai_assistant_thread
  FOR EACH ROW
  EXECUTE FUNCTION private.ai_assistant_reject_thread_reparent();

CREATE OR REPLACE FUNCTION private.ai_assistant_reject_message_reparent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.thread_id IS DISTINCT FROM OLD.thread_id THEN
    RAISE EXCEPTION 'AI_ASSISTANT_MESSAGE_THREAD_IMMUTABLE';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'AI_ASSISTANT_MESSAGE_ROLE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ai_assistant_reject_message_reparent()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ai_assistant_message_reparent_guard
  ON public.ai_assistant_message;
CREATE TRIGGER ai_assistant_message_reparent_guard
  BEFORE UPDATE OF thread_id, role
  ON public.ai_assistant_message
  FOR EACH ROW
  EXECUTE FUNCTION private.ai_assistant_reject_message_reparent();
