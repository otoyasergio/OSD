-- Internal staff messenger: 1:1 + group chat, media, reactions, calls.
-- Separate from customer-facing SMS (lib/twilio/, sms_consent_event).

CREATE TABLE chat_conversation (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('dm', 'group')),
  title text,
  dm_key text,
  created_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_conversation_dm_key_check CHECK (
    (type = 'dm' AND dm_key IS NOT NULL) OR (type = 'group' AND dm_key IS NULL)
  )
);

-- Sorted "userIdA:userIdB" pair so "message X" always opens the same DM thread.
CREATE UNIQUE INDEX idx_chat_conversation_dm_key
  ON chat_conversation (dm_key) WHERE type = 'dm';

CREATE TABLE chat_participant (
  conversation_id uuid NOT NULL REFERENCES chat_conversation (conversation_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  muted_at timestamptz,
  pinned_at timestamptz,
  hidden_at timestamptz,
  left_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_chat_participant_user ON chat_participant (user_id);

CREATE TABLE chat_message (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversation (conversation_id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'image', 'audio', 'system', 'call_event')),
  body text,
  reply_to_message_id uuid REFERENCES chat_message (message_id) ON DELETE SET NULL,
  edited_at timestamptz,
  unsent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_message_conversation ON chat_message (conversation_id, created_at DESC);

CREATE TABLE chat_attachment (
  attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_message (message_id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  bytes integer,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_reaction (
  message_id uuid NOT NULL REFERENCES chat_message (message_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE chat_call (
  call_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversation (conversation_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('audio', 'video')),
  twilio_room_sid text,
  twilio_room_name text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('ringing', 'active', 'ended', 'missed')) DEFAULT 'ringing',
  started_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

-- RLS helper: current user is an active (non-left) participant of a conversation.
CREATE OR REPLACE FUNCTION public.is_chat_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_participant cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id = current_app_user_id()
      AND cp.left_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_chat_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_chat_participant(uuid) TO authenticated, service_role;

ALTER TABLE chat_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_reaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_call ENABLE ROW LEVEL SECURITY;

-- chat_conversation: any active staff member may create (DM/group);
-- read as participant, or as creator (needed for INSERT ... RETURNING before participants exist).
CREATE POLICY chat_conversation_select ON chat_conversation
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND (
      public.is_chat_participant(conversation_id)
      OR created_by_user_id = current_app_user_id()
    )
  );

CREATE POLICY chat_conversation_insert ON chat_conversation
  FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY chat_conversation_update ON chat_conversation
  FOR UPDATE TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id))
  WITH CHECK (is_active_app_user() AND public.is_chat_participant(conversation_id));

-- chat_participant: see co-participants of your own conversations;
-- always see your own row (needed while bootstrapping membership).
CREATE POLICY chat_participant_select ON chat_participant
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR public.is_chat_participant(conversation_id)
    )
  );

CREATE POLICY chat_participant_insert ON chat_participant
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND (user_id = current_app_user_id() OR public.is_chat_participant(conversation_id))
  );

CREATE POLICY chat_participant_update ON chat_participant
  FOR UPDATE TO authenticated
  USING (is_active_app_user() AND user_id = current_app_user_id())
  WITH CHECK (is_active_app_user() AND user_id = current_app_user_id());

-- chat_message: participants read; only the sender may insert as themselves or update (edit/unsend) their own row.
CREATE POLICY chat_message_select ON chat_message
  FOR SELECT TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id));

CREATE POLICY chat_message_insert ON chat_message
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND public.is_chat_participant(conversation_id)
    AND sender_user_id = current_app_user_id()
  );

CREATE POLICY chat_message_update ON chat_message
  FOR UPDATE TO authenticated
  USING (is_active_app_user() AND sender_user_id = current_app_user_id())
  WITH CHECK (is_active_app_user() AND sender_user_id = current_app_user_id());

-- chat_attachment: readable/insertable via the parent message's conversation.
CREATE POLICY chat_attachment_select ON chat_attachment
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM chat_message m
      WHERE m.message_id = chat_attachment.message_id
        AND public.is_chat_participant(m.conversation_id)
    )
  );

CREATE POLICY chat_attachment_insert ON chat_attachment
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM chat_message m
      WHERE m.message_id = chat_attachment.message_id
        AND m.sender_user_id = current_app_user_id()
    )
  );

-- chat_reaction: participants read; anyone may react/unreact as themselves.
CREATE POLICY chat_reaction_select ON chat_reaction
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM chat_message m
      WHERE m.message_id = chat_reaction.message_id
        AND public.is_chat_participant(m.conversation_id)
    )
  );

CREATE POLICY chat_reaction_insert ON chat_reaction
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND user_id = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM chat_message m
      WHERE m.message_id = chat_reaction.message_id
        AND public.is_chat_participant(m.conversation_id)
    )
  );

CREATE POLICY chat_reaction_delete ON chat_reaction
  FOR DELETE TO authenticated
  USING (is_active_app_user() AND user_id = current_app_user_id());

-- chat_call: participants only; server route inserts/updates using the caller's own session.
CREATE POLICY chat_call_select ON chat_call
  FOR SELECT TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id));

CREATE POLICY chat_call_insert ON chat_call
  FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user() AND public.is_chat_participant(conversation_id));

CREATE POLICY chat_call_update ON chat_call
  FOR UPDATE TO authenticated
  USING (is_active_app_user() AND public.is_chat_participant(conversation_id))
  WITH CHECK (is_active_app_user() AND public.is_chat_participant(conversation_id));

-- Storage: chat-media bucket for photos + voice notes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  false,
  26214400,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
        'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/aac']
)
ON CONFLICT (id) DO NOTHING;

-- Storage: path first segment is conversation_id; require participant.
CREATE POLICY chat_media_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND is_active_app_user()
    AND public.is_chat_participant((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY chat_media_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND is_active_app_user()
    AND public.is_chat_participant((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY chat_media_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND is_active_app_user()
    AND public.is_chat_participant((storage.foldername(name))[1]::uuid)
  );

-- Realtime: first feature in this repo to use it — confirm in Studio if this errors
-- in a given environment (self-hosted publications can differ from cloud defaults).
ALTER PUBLICATION supabase_realtime ADD TABLE chat_message, chat_reaction, chat_participant, chat_call;
