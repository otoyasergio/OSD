-- Ask OTOMOTO server-owned persistence. Authenticated staff can read only
-- through assignment-aware RLS; all writes use the server service-role client.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Composite keys let the database enforce denormalized work-order/location and
-- job/work-order relationships without relying on application checks.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_order_id_location
  ON public.work_order (work_order_id, location_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_id_work_order
  ON public.job (job_id, work_order_id);

CREATE INDEX IF NOT EXISTS idx_job_work_order_assigned_technician
  ON public.job (work_order_id, assigned_technician_id)
  WHERE assigned_technician_id IS NOT NULL;

CREATE TABLE public.ai_assistant_thread (
  ai_assistant_thread_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL,
  job_id uuid,
  location_id uuid NOT NULL,
  mode text NOT NULL CHECK (
    mode IN ('shop', 'teach', 'intake', 'advisor', 'report')
  ),
  audience text NOT NULL DEFAULT 'technical' CHECK (
    audience IN ('technical', 'front_office')
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'generating', 'ready', 'failed', 'archived')
  ),
  diagnostic_phase text,
  trigger_type text,
  trigger_entity_id uuid,
  created_by_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_assistant_thread_trigger_identity_complete CHECK (
    (trigger_type IS NULL) = (trigger_entity_id IS NULL)
  ),
  CONSTRAINT ai_assistant_thread_work_order_location_fk
    FOREIGN KEY (work_order_id, location_id)
    REFERENCES public.work_order(work_order_id, location_id)
    ON DELETE CASCADE,
  CONSTRAINT ai_assistant_thread_job_work_order_fk
    FOREIGN KEY (job_id, work_order_id)
    REFERENCES public.job(job_id, work_order_id)
    ON DELETE SET NULL (job_id)
);

CREATE UNIQUE INDEX uq_ai_assistant_thread_trigger_identity
  ON public.ai_assistant_thread (trigger_type, trigger_entity_id)
  WHERE trigger_type IS NOT NULL AND trigger_entity_id IS NOT NULL;

CREATE INDEX idx_ai_assistant_thread_work_order_chronology
  ON public.ai_assistant_thread (work_order_id, created_at DESC);

CREATE INDEX idx_ai_assistant_thread_job_chronology
  ON public.ai_assistant_thread (job_id, created_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX idx_ai_assistant_thread_location
  ON public.ai_assistant_thread (location_id);

CREATE INDEX idx_ai_assistant_thread_creator
  ON public.ai_assistant_thread (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

CREATE TABLE public.ai_assistant_message (
  ai_assistant_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL
    REFERENCES public.ai_assistant_thread(ai_assistant_thread_id)
    ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  body text,
  generation_status text NOT NULL DEFAULT 'pending' CHECK (
    generation_status IN ('pending', 'generating', 'ready', 'failed')
  ),
  requested_input jsonb,
  phase text,
  created_by_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  provider_model text,
  provider_response_id text,
  prompt_version text,
  input_token_count integer CHECK (
    input_token_count IS NULL OR input_token_count >= 0
  ),
  output_token_count integer CHECK (
    output_token_count IS NULL OR output_token_count >= 0
  ),
  context_as_of timestamptz,
  context_hash text,
  safe_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_assistant_message_requested_input_structured CHECK (
    requested_input IS NULL
    OR jsonb_typeof(requested_input) IN ('object', 'array')
  )
);

CREATE INDEX idx_ai_assistant_message_thread_chronology
  ON public.ai_assistant_message (thread_id, created_at);

CREATE INDEX idx_ai_assistant_message_creator
  ON public.ai_assistant_message (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

CREATE INDEX idx_ai_assistant_message_provider_response
  ON public.ai_assistant_message (provider_response_id)
  WHERE provider_response_id IS NOT NULL;

CREATE TABLE public.ai_assistant_message_photo (
  message_id uuid NOT NULL
    REFERENCES public.ai_assistant_message(ai_assistant_message_id)
    ON DELETE CASCADE,
  photo_id uuid NOT NULL
    REFERENCES public.intake_photo(photo_id)
    ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  purpose text NOT NULL CHECK (length(btrim(purpose)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, photo_id),
  UNIQUE (message_id, sort_order)
);

CREATE INDEX idx_ai_assistant_message_photo_photo
  ON public.ai_assistant_message_photo (photo_id);

ALTER TABLE public.technician_note
  ADD COLUMN source_ai_message_id uuid
    REFERENCES public.ai_assistant_message(ai_assistant_message_id)
    ON DELETE SET NULL;

CREATE INDEX idx_technician_note_source_ai_message
  ON public.technician_note (source_ai_message_id)
  WHERE source_ai_message_id IS NOT NULL;

-- Keep a message's parent immutable: moving generated content to a different
-- thread would silently change its work-order and RLS scope.
CREATE FUNCTION private.ai_assistant_reject_message_reparent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.thread_id IS DISTINCT FROM OLD.thread_id THEN
    RAISE EXCEPTION 'AI_ASSISTANT_MESSAGE_THREAD_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ai_assistant_reject_message_reparent()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_assistant_message_reparent_guard
  BEFORE UPDATE OF thread_id ON public.ai_assistant_message
  FOR EACH ROW
  EXECUTE FUNCTION private.ai_assistant_reject_message_reparent();

-- Work-order, job, and location define the authorization boundary and are
-- immutable after a thread is created.
CREATE FUNCTION private.ai_assistant_reject_thread_reparent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
  THEN
    RAISE EXCEPTION 'AI_ASSISTANT_THREAD_SCOPE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ai_assistant_reject_thread_reparent()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_assistant_thread_reparent_guard
  BEFORE UPDATE OF work_order_id, job_id, location_id
  ON public.ai_assistant_thread
  FOR EACH ROW
  EXECUTE FUNCTION private.ai_assistant_reject_thread_reparent();

-- Links reference existing intake-photo rows, never duplicate image bytes.
-- Context photos must come from the thread's work order. Job work/proof photos
-- must additionally belong to the exact job when the thread is job-scoped.
CREATE FUNCTION private.ai_assistant_validate_message_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  thread_work_order_id uuid;
  thread_job_id uuid;
  photo_work_order_id uuid;
  photo_job_id uuid;
  photo_category text;
BEGIN
  SELECT
    thread.work_order_id,
    thread.job_id,
    photo.work_order_id,
    photo.job_id,
    photo.category
  INTO
    thread_work_order_id,
    thread_job_id,
    photo_work_order_id,
    photo_job_id,
    photo_category
  FROM public.ai_assistant_message AS message
  JOIN public.ai_assistant_thread AS thread
    ON thread.ai_assistant_thread_id = message.thread_id
  CROSS JOIN public.intake_photo AS photo
  WHERE message.ai_assistant_message_id = NEW.message_id
    AND photo.photo_id = NEW.photo_id;

  -- Let the declarative foreign keys report missing parent rows.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF photo_work_order_id IS DISTINCT FROM thread_work_order_id THEN
    RAISE EXCEPTION 'AI_ASSISTANT_PHOTO_WORK_ORDER_MISMATCH';
  END IF;

  IF thread_job_id IS NOT NULL
    AND photo_category IN ('job_work', 'job_proof')
    AND photo_job_id IS DISTINCT FROM thread_job_id
  THEN
    RAISE EXCEPTION 'AI_ASSISTANT_PHOTO_JOB_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ai_assistant_validate_message_photo()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_assistant_message_photo_scope_guard
  BEFORE INSERT OR UPDATE OF message_id, photo_id
  ON public.ai_assistant_message_photo
  FOR EACH ROW
  EXECUTE FUNCTION private.ai_assistant_validate_message_photo();

-- An intake photo that is already linked cannot later be moved across the same
-- work-order/job boundary through a service-role update.
CREATE FUNCTION private.ai_assistant_validate_linked_intake_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ai_assistant_message_photo AS link
    JOIN public.ai_assistant_message AS message
      ON message.ai_assistant_message_id = link.message_id
    JOIN public.ai_assistant_thread AS thread
      ON thread.ai_assistant_thread_id = message.thread_id
    WHERE link.photo_id = NEW.photo_id
      AND NEW.work_order_id IS DISTINCT FROM thread.work_order_id
  ) THEN
    RAISE EXCEPTION 'AI_ASSISTANT_PHOTO_WORK_ORDER_MISMATCH';
  END IF;

  IF NEW.category IN ('job_work', 'job_proof')
    AND EXISTS (
      SELECT 1
      FROM public.ai_assistant_message_photo AS link
      JOIN public.ai_assistant_message AS message
        ON message.ai_assistant_message_id = link.message_id
      JOIN public.ai_assistant_thread AS thread
        ON thread.ai_assistant_thread_id = message.thread_id
      WHERE link.photo_id = NEW.photo_id
        AND thread.job_id IS NOT NULL
        AND NEW.job_id IS DISTINCT FROM thread.job_id
    )
  THEN
    RAISE EXCEPTION 'AI_ASSISTANT_PHOTO_JOB_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ai_assistant_validate_linked_intake_photo()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_assistant_linked_intake_photo_scope_guard
  BEFORE UPDATE OF work_order_id, job_id, category
  ON public.intake_photo
  FOR EACH ROW
  EXECUTE FUNCTION private.ai_assistant_validate_linked_intake_photo();

-- Mirrors lib/workOrders/assignmentVisibility.ts. Active staff must belong to
-- the thread's active location. Front-office roles can read either audience;
-- floor roles can read technical threads only when assigned, with the head-tech
-- safety-check exception.
CREATE FUNCTION private.can_view_ai_assistant_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ai_assistant_thread AS thread
    JOIN public.work_order AS work_order
      ON work_order.work_order_id = thread.work_order_id
    JOIN public.location AS location
      ON location.location_id = thread.location_id
      AND location.status = 'active'
    JOIN public.app_user AS app_user
      ON app_user.auth_user_id = (SELECT auth.uid())
      AND app_user.status = 'active'
      AND app_user.user_id = (SELECT public.current_app_user_id())
    JOIN public.user_location AS membership
      ON membership.user_id = app_user.user_id
      AND membership.location_id = thread.location_id
    WHERE thread.ai_assistant_thread_id = p_thread_id
      AND (
        app_user.role IN ('owner', 'manager', 'service_advisor', 'admin')
        OR (
          thread.audience = 'technical'
          AND app_user.role IN ('technician', 'head_tech')
          AND (
            work_order.primary_technician_id = app_user.user_id
            OR work_order.quality_check_assigned_to = app_user.user_id
            OR EXISTS (
              SELECT 1
              FROM public.job AS assigned_job
              WHERE assigned_job.work_order_id = work_order.work_order_id
                AND assigned_job.assigned_technician_id = app_user.user_id
            )
            OR (
              app_user.role = 'head_tech'
              AND work_order.status = 'safety_check'
            )
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.can_view_ai_assistant_thread(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_view_ai_assistant_thread(uuid)
  TO authenticated, service_role;

ALTER TABLE public.ai_assistant_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assistant_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assistant_message_photo ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_assistant_thread_select
  ON public.ai_assistant_thread
  FOR SELECT TO authenticated
  USING (
    (SELECT private.can_view_ai_assistant_thread(ai_assistant_thread_id))
  );

CREATE POLICY ai_assistant_message_select
  ON public.ai_assistant_message
  FOR SELECT TO authenticated
  USING (
    (SELECT private.can_view_ai_assistant_thread(thread_id))
  );

CREATE POLICY ai_assistant_message_photo_select
  ON public.ai_assistant_message_photo
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ai_assistant_message AS message
      WHERE message.ai_assistant_message_id =
        public.ai_assistant_message_photo.message_id
        AND private.can_view_ai_assistant_thread(message.thread_id)
    )
  );

REVOKE ALL ON TABLE public.ai_assistant_thread
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_assistant_message
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_assistant_message_photo
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.ai_assistant_thread TO authenticated;
GRANT SELECT ON TABLE public.ai_assistant_message TO authenticated;
GRANT SELECT ON TABLE public.ai_assistant_message_photo TO authenticated;

GRANT ALL ON TABLE public.ai_assistant_thread TO service_role;
GRANT ALL ON TABLE public.ai_assistant_message TO service_role;
GRANT ALL ON TABLE public.ai_assistant_message_photo TO service_role;

COMMENT ON TABLE public.ai_assistant_thread IS
  'Ask OTOMOTO conversation scope and generation lifecycle.';
COMMENT ON TABLE public.ai_assistant_message IS
  'Server-generated Ask OTOMOTO prompts, responses, metadata, and safe failures.';
COMMENT ON TABLE public.ai_assistant_message_photo IS
  'Ordered references to intake photos; image bytes remain in storage.';
COMMENT ON COLUMN public.technician_note.source_ai_message_id IS
  'Optional trace to the reviewed AI message; the technician note remains authoritative.';
