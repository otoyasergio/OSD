-- Staff notes about a screen that looks wrong, plus the nightly zip that packs them.

CREATE TABLE public.staff_feedback_digest (
  digest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_date date NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  report_count integer NOT NULL CHECK (report_count > 0),
  archive_path text NOT NULL,
  summary text NOT NULL,
  archive_bytes integer NOT NULL CHECK (archive_bytes > 0 AND archive_bytes <= 33554432),
  CONSTRAINT staff_feedback_digest_archive_path CHECK (
    archive_path = ('digests/' || shop_date::text || '.zip')
  ),
  CONSTRAINT staff_feedback_digest_summary_length CHECK (
    char_length(summary) BETWEEN 1 AND 12000
  )
);

COMMENT ON TABLE public.staff_feedback_digest IS
  'One night''s staff screen notes and pictures, packed into a single zip.';

CREATE INDEX staff_feedback_digest_created_idx
  ON public.staff_feedback_digest (created_at DESC);

CREATE TABLE public.staff_feedback_report (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES public.app_user (user_id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.location (location_id) ON DELETE SET NULL,
  role text NOT NULL,
  page_path text NOT NULL,
  note text NOT NULL,
  viewport_width integer,
  viewport_height integer,
  had_screenshot boolean NOT NULL DEFAULT false,
  screenshot_path text,
  digest_id uuid REFERENCES public.staff_feedback_digest (digest_id) ON DELETE NO ACTION,
  squashed_at timestamptz,
  CONSTRAINT staff_feedback_report_role_check CHECK (
    role IN (
      'owner',
      'manager',
      'service_advisor',
      'technician',
      'head_tech',
      'admin'
    )
  ),
  CONSTRAINT staff_feedback_report_note_length CHECK (char_length(note) BETWEEN 1 AND 2000),
  CONSTRAINT staff_feedback_report_page_path CHECK (
    char_length(page_path) BETWEEN 1 AND 300
    AND page_path ~ '^/[A-Za-z0-9_./~%-]*$'
    AND position('..' in page_path) = 0
  ),
  CONSTRAINT staff_feedback_report_viewport CHECK (
    (viewport_width IS NULL OR viewport_width BETWEEN 1 AND 10000)
    AND (viewport_height IS NULL OR viewport_height BETWEEN 1 AND 10000)
  ),
  CONSTRAINT staff_feedback_report_screenshot_path CHECK (
    screenshot_path IS NULL
    OR (
      screenshot_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
      AND split_part(screenshot_path, '/', 1) = actor_user_id::text
    )
  ),
  CONSTRAINT staff_feedback_report_screenshot_flag CHECK (
    screenshot_path IS NULL OR had_screenshot
  ),
  CONSTRAINT staff_feedback_report_squash_pair CHECK (
    (squashed_at IS NULL AND digest_id IS NULL)
    OR (squashed_at IS NOT NULL AND digest_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.staff_feedback_report IS
  'A staff note, and optional picture, about a screen that does not make sense.';

CREATE INDEX staff_feedback_report_created_idx
  ON public.staff_feedback_report (created_at DESC);

CREATE INDEX staff_feedback_report_actor_created_idx
  ON public.staff_feedback_report (actor_user_id, created_at DESC);

CREATE INDEX staff_feedback_report_open_idx
  ON public.staff_feedback_report (created_at)
  WHERE squashed_at IS NULL;

ALTER TABLE public.staff_feedback_digest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_feedback_report ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_feedback_digest_select
  ON public.staff_feedback_digest
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) = 'owner'
  );

CREATE POLICY staff_feedback_report_select
  ON public.staff_feedback_report
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (
      actor_user_id = (SELECT public.current_app_user_id())
      OR (SELECT public.current_app_user_role()) = 'owner'
    )
  );

CREATE POLICY staff_feedback_report_insert
  ON public.staff_feedback_report
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) <> 'time_clock_kiosk'
    AND actor_user_id = (SELECT public.current_app_user_id())
    AND role = (SELECT public.current_app_user_role())
    AND squashed_at IS NULL
    AND digest_id IS NULL
    AND (
      location_id IS NULL
      OR location_id IN (SELECT public.user_location_ids())
    )
  );

REVOKE ALL ON TABLE public.staff_feedback_digest FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.staff_feedback_report FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.staff_feedback_digest TO authenticated;
GRANT SELECT, INSERT ON TABLE public.staff_feedback_report TO authenticated;
GRANT ALL ON TABLE public.staff_feedback_digest TO service_role;
GRANT ALL ON TABLE public.staff_feedback_report TO service_role;

-- Atomic insert of the day's row and mark of the notes it contains.
-- Invoker so the service role's privileges apply. Not callable by staff.
CREATE OR REPLACE FUNCTION public.commit_staff_feedback_squash(
  p_shop_date date,
  p_archive_path text,
  p_summary text,
  p_archive_bytes integer,
  p_report_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_digest_id uuid;
BEGIN
  IF p_report_ids IS NULL OR cardinality(p_report_ids) = 0 THEN
    RAISE EXCEPTION 'STAFF_FEEDBACK_NOTHING_TO_SQUASH';
  END IF;
  IF p_archive_bytes IS NULL OR p_archive_bytes <= 0 OR p_archive_bytes > 33554432 THEN
    RAISE EXCEPTION 'STAFF_FEEDBACK_SQUASH_FAILED';
  END IF;
  IF p_archive_path IS DISTINCT FROM ('digests/' || p_shop_date::text || '.zip') THEN
    RAISE EXCEPTION 'STAFF_FEEDBACK_DATE_INVALID';
  END IF;
  IF p_summary IS NULL OR char_length(p_summary) < 1 OR char_length(p_summary) > 12000 THEN
    RAISE EXCEPTION 'STAFF_FEEDBACK_SQUASH_FAILED';
  END IF;

  INSERT INTO public.staff_feedback_digest (
    shop_date,
    report_count,
    archive_path,
    summary,
    archive_bytes
  ) VALUES (
    p_shop_date,
    cardinality(p_report_ids),
    p_archive_path,
    p_summary,
    p_archive_bytes
  )
  RETURNING digest_id INTO v_digest_id;

  UPDATE public.staff_feedback_report
  SET digest_id = v_digest_id,
      squashed_at = now()
  WHERE report_id = ANY (p_report_ids)
    AND squashed_at IS NULL;

  RETURN v_digest_id;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_staff_feedback_squash(date, text, text, integer, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_staff_feedback_squash(date, text, text, integer, uuid[])
  TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-feedback',
  'staff-feedback',
  false,
  33554432,
  ARRAY['image/jpeg', 'application/zip']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS staff_feedback_objects_select ON storage.objects;
CREATE POLICY staff_feedback_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'staff-feedback'
    AND (SELECT public.is_active_app_user())
    AND (
      (SELECT public.current_app_user_role()) = 'owner'
      OR (storage.foldername(name))[1] = (SELECT public.current_app_user_id())::text
    )
  );

DROP POLICY IF EXISTS staff_feedback_objects_insert ON storage.objects;
CREATE POLICY staff_feedback_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'staff-feedback'
    AND (SELECT public.is_active_app_user())
    AND (storage.foldername(name))[1] = (SELECT public.current_app_user_id())::text
    AND name ~ (
      '^' || (SELECT public.current_app_user_id())::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
    )
  );
