-- Harden staff messenger: storage ACL, unhide-on-message, group member removal.

-- Storage: path first segment is conversation_id; require participant.
DROP POLICY IF EXISTS chat_media_select ON storage.objects;
DROP POLICY IF EXISTS chat_media_insert ON storage.objects;
DROP POLICY IF EXISTS chat_media_delete ON storage.objects;

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

-- Clear hidden_at for other participants when a new message arrives.
CREATE OR REPLACE FUNCTION public.chat_clear_hidden_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE chat_participant
  SET hidden_at = NULL
  WHERE conversation_id = NEW.conversation_id
    AND user_id IS DISTINCT FROM NEW.sender_user_id
    AND hidden_at IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_clear_hidden_on_message ON chat_message;
CREATE TRIGGER trg_chat_clear_hidden_on_message
  AFTER INSERT ON chat_message
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_clear_hidden_on_message();

-- Allow creator / owner / manager to mark another member as left.
CREATE OR REPLACE FUNCTION public.chat_can_manage_members(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_conversation c
    WHERE c.conversation_id = p_conversation_id
      AND c.type = 'group'
      AND (
        c.created_by_user_id = current_app_user_id()
        OR current_app_user_role() IN ('owner', 'manager')
      )
  );
$$;

REVOKE ALL ON FUNCTION public.chat_can_manage_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_can_manage_members(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS chat_participant_update ON chat_participant;
CREATE POLICY chat_participant_update ON chat_participant
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR public.chat_can_manage_members(conversation_id)
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR public.chat_can_manage_members(conversation_id)
    )
  );

-- Restrict adding others: self, or group managers / existing participants on groups only.
DROP POLICY IF EXISTS chat_participant_insert ON chat_participant;
CREATE POLICY chat_participant_insert ON chat_participant
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR (
        public.is_chat_participant(conversation_id)
        AND EXISTS (
          SELECT 1 FROM chat_conversation c
          WHERE c.conversation_id = chat_participant.conversation_id
            AND (
              c.type = 'group'
              OR c.created_by_user_id = current_app_user_id()
            )
        )
      )
    )
  );
