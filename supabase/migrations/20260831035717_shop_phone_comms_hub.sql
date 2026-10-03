-- Shop phone (Twilio Voice) + presence for the communications hub.
-- PSTN is front-office only; staff audio uses Client identities; no recording.

ALTER TABLE location
  ADD COLUMN voice_e164 text;

ALTER TABLE location
  ADD CONSTRAINT location_voice_e164_format
  CHECK (
    voice_e164 IS NULL
    OR voice_e164 ~ '^\+[1-9][0-9]{7,14}$'
  );

CREATE UNIQUE INDEX location_voice_e164_unique
  ON location (voice_e164)
  WHERE voice_e164 IS NOT NULL;

CREATE TABLE staff_voice_presence (
  user_id uuid PRIMARY KEY REFERENCES app_user (user_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location (location_id) ON DELETE CASCADE,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX staff_voice_presence_location_updated_idx
  ON staff_voice_presence (location_id, updated_at DESC);

CREATE TABLE phone_call (
  phone_call_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel text NOT NULL CHECK (channel IN ('staff', 'pstn')),
  location_id uuid NOT NULL REFERENCES location (location_id) ON DELETE RESTRICT,
  from_e164 text,
  to_e164 text,
  from_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customer (customer_id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES work_order (work_order_id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES chat_conversation (conversation_id) ON DELETE SET NULL,
  twilio_call_sid text,
  status text NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing', 'in_progress', 'completed', 'missed', 'no_answer', 'busy', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX phone_call_twilio_sid_unique
  ON phone_call (twilio_call_sid)
  WHERE twilio_call_sid IS NOT NULL;

CREATE INDEX phone_call_location_started_idx
  ON phone_call (location_id, started_at DESC);

CREATE INDEX phone_call_customer_idx
  ON phone_call (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX phone_call_conversation_idx
  ON phone_call (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX phone_call_from_user_idx
  ON phone_call (from_user_id)
  WHERE from_user_id IS NOT NULL;

CREATE INDEX phone_call_to_user_idx
  ON phone_call (to_user_id)
  WHERE to_user_id IS NOT NULL;

ALTER TABLE staff_voice_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_call ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_front_office_app_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_app_user_role() IN ('owner', 'manager', 'service_advisor');
$$;

REVOKE ALL ON FUNCTION public.is_front_office_app_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_front_office_app_user() TO authenticated, service_role;

CREATE POLICY staff_voice_presence_select ON staff_voice_presence
  FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY staff_voice_presence_insert ON staff_voice_presence
  FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user() AND user_id = current_app_user_id());

CREATE POLICY staff_voice_presence_update ON staff_voice_presence
  FOR UPDATE TO authenticated
  USING (is_active_app_user() AND user_id = current_app_user_id())
  WITH CHECK (is_active_app_user() AND user_id = current_app_user_id());

CREATE POLICY staff_voice_presence_delete ON staff_voice_presence
  FOR DELETE TO authenticated
  USING (is_active_app_user() AND user_id = current_app_user_id());

CREATE POLICY phone_call_select ON phone_call
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND (
      from_user_id = current_app_user_id()
      OR to_user_id = current_app_user_id()
      OR (
        conversation_id IS NOT NULL
        AND public.is_chat_participant(conversation_id)
      )
      OR (
        channel = 'pstn'
        AND public.is_front_office_app_user()
        AND location_id IN (SELECT public.user_location_ids())
      )
    )
  );

CREATE POLICY phone_call_insert ON phone_call
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND from_user_id = current_app_user_id()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      channel = 'staff'
      OR (channel = 'pstn' AND public.is_front_office_app_user())
    )
  );

CREATE POLICY phone_call_update ON phone_call
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND (
      from_user_id = current_app_user_id()
      OR to_user_id = current_app_user_id()
      OR (
        conversation_id IS NOT NULL
        AND public.is_chat_participant(conversation_id)
      )
      OR (
        channel = 'pstn'
        AND public.is_front_office_app_user()
        AND location_id IN (SELECT public.user_location_ids())
      )
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND (
      from_user_id = current_app_user_id()
      OR to_user_id = current_app_user_id()
      OR (
        conversation_id IS NOT NULL
        AND public.is_chat_participant(conversation_id)
      )
      OR (
        channel = 'pstn'
        AND public.is_front_office_app_user()
        AND location_id IN (SELECT public.user_location_ids())
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_voice_presence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_voice_presence TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phone_call TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phone_call TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE staff_voice_presence, phone_call, chat_conversation;
