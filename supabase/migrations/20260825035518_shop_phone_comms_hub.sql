-- Shop phone (Twilio Voice) + staff presence for inbound routing.
-- Staff chat stays on chat_*; chat_call remains video-only.

ALTER TABLE public.location
  ADD COLUMN voice_e164 text;

ALTER TABLE public.location
  ADD CONSTRAINT location_voice_e164_format
  CHECK (
    voice_e164 IS NULL
    OR voice_e164 ~ '^\+[1-9][0-9]{9,14}$'
  );

CREATE UNIQUE INDEX idx_location_voice_e164
  ON public.location (voice_e164)
  WHERE voice_e164 IS NOT NULL;

CREATE TABLE public.staff_voice_presence (
  user_id uuid PRIMARY KEY REFERENCES public.app_user (user_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.location (location_id) ON DELETE CASCADE,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_voice_presence_location
  ON public.staff_voice_presence (location_id);

CREATE TABLE public.phone_call (
  phone_call_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel text NOT NULL CHECK (channel IN ('staff', 'pstn')),
  location_id uuid NOT NULL REFERENCES public.location (location_id) ON DELETE RESTRICT,
  from_e164 text,
  to_e164 text,
  from_user_id uuid REFERENCES public.app_user (user_id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES public.app_user (user_id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customer (customer_id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.work_order (work_order_id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.chat_conversation (conversation_id) ON DELETE SET NULL,
  twilio_call_sid text,
  status text NOT NULL DEFAULT 'ringing'
    CHECK (status IN (
      'ringing',
      'in_progress',
      'completed',
      'missed',
      'no_answer',
      'busy',
      'failed'
    )),
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_phone_call_twilio_sid
  ON public.phone_call (twilio_call_sid)
  WHERE twilio_call_sid IS NOT NULL;

CREATE INDEX idx_phone_call_location_started
  ON public.phone_call (location_id, started_at DESC);

CREATE INDEX idx_phone_call_customer
  ON public.phone_call (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX idx_phone_call_conversation
  ON public.phone_call (conversation_id)
  WHERE conversation_id IS NOT NULL;

REVOKE ALL ON TABLE public.staff_voice_presence FROM anon;
REVOKE ALL ON TABLE public.phone_call FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_voice_presence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_voice_presence TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phone_call TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phone_call TO service_role;

ALTER TABLE public.staff_voice_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_call ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_voice_presence_select ON public.staff_voice_presence
  FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY staff_voice_presence_insert ON public.staff_voice_presence
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND user_id = (SELECT public.current_app_user_id())
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY staff_voice_presence_update ON public.staff_voice_presence
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND user_id = (SELECT public.current_app_user_id())
  )
  WITH CHECK (
    is_active_app_user()
    AND user_id = (SELECT public.current_app_user_id())
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY staff_voice_presence_delete ON public.staff_voice_presence
  FOR DELETE TO authenticated
  USING (
    is_active_app_user()
    AND user_id = (SELECT public.current_app_user_id())
  );

CREATE POLICY phone_call_select ON public.phone_call
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND (
      from_user_id = (SELECT public.current_app_user_id())
      OR to_user_id = (SELECT public.current_app_user_id())
      OR (
        conversation_id IS NOT NULL
        AND public.is_chat_participant(conversation_id)
      )
      OR (
        channel = 'pstn'
        AND (SELECT public.current_app_user_role()) IN (
          'owner',
          'manager',
          'service_advisor'
        )
        AND location_id IN (SELECT public.user_location_ids())
      )
    )
  );

CREATE POLICY phone_call_insert ON public.phone_call
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND from_user_id = (SELECT public.current_app_user_id())
  );

CREATE POLICY phone_call_update ON public.phone_call
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND (
      from_user_id = (SELECT public.current_app_user_id())
      OR to_user_id = (SELECT public.current_app_user_id())
      OR (
        channel = 'pstn'
        AND (SELECT public.current_app_user_role()) IN (
          'owner',
          'manager',
          'service_advisor'
        )
        AND location_id IN (SELECT public.user_location_ids())
      )
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND (
      from_user_id = (SELECT public.current_app_user_id())
      OR to_user_id = (SELECT public.current_app_user_id())
      OR (
        channel = 'pstn'
        AND (SELECT public.current_app_user_role()) IN (
          'owner',
          'manager',
          'service_advisor'
        )
        AND location_id IN (SELECT public.user_location_ids())
      )
    )
  );

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.phone_call;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_voice_presence;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
