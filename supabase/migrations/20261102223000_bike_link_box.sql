CREATE TABLE public.bike_link_box (
  box_id text PRIMARY KEY,
  motorcycle_id uuid NOT NULL UNIQUE
    REFERENCES public.motorcycle (motorcycle_id) ON DELETE CASCADE,
  paired_at timestamptz NOT NULL DEFAULT now(),
  paired_by_user_id uuid
    REFERENCES public.app_user (user_id) ON DELETE SET NULL,
  CONSTRAINT bike_link_box_id_shape
    CHECK (box_id ~ '^TM-BL-[0-9]{4}$')
);

COMMENT ON TABLE public.bike_link_box IS
  'Sticker on one bike box. One box, one motorcycle.';

ALTER TABLE public.bike_link_reading
  ADD COLUMN box_id text
    REFERENCES public.bike_link_box (box_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX bike_link_reading_box_recorded
  ON public.bike_link_reading (box_id, recorded_at)
  WHERE box_id IS NOT NULL;

ALTER TABLE public.bike_link_box ENABLE ROW LEVEL SECURITY;

CREATE POLICY bike_link_box_select ON public.bike_link_box
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

CREATE POLICY bike_link_box_insert ON public.bike_link_box
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

CREATE POLICY bike_link_box_update ON public.bike_link_box
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_active_app_user()))
  WITH CHECK ((SELECT public.is_active_app_user()));

CREATE POLICY bike_link_box_delete ON public.bike_link_box
  FOR DELETE TO authenticated
  USING ((SELECT public.is_active_app_user()));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bike_link_box TO authenticated;

-- box_id is the primary key, so a new sticker replaces the old row in one transaction.
CREATE OR REPLACE FUNCTION public.replace_bike_link_box(
  p_motorcycle_id uuid,
  p_box_id text,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bike_link_box
    WHERE box_id = p_box_id
      AND motorcycle_id <> p_motorcycle_id
  ) THEN
    RAISE EXCEPTION 'That box is already paired.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bike_link_box
    WHERE box_id = p_box_id
      AND motorcycle_id = p_motorcycle_id
  ) THEN
    RETURN;
  END IF;

  DELETE FROM public.bike_link_box
  WHERE motorcycle_id = p_motorcycle_id;

  INSERT INTO public.bike_link_box (box_id, motorcycle_id, paired_by_user_id)
  VALUES (p_box_id, p_motorcycle_id, p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_bike_link_box(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_bike_link_box(uuid, text, uuid) TO authenticated;
