-- Fix INSERT ... RETURNING on new conversations before participants exist.

DROP POLICY IF EXISTS chat_conversation_select ON chat_conversation;
CREATE POLICY chat_conversation_select ON chat_conversation
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND (
      public.is_chat_participant(conversation_id)
      OR created_by_user_id = current_app_user_id()
    )
  );

DROP POLICY IF EXISTS chat_participant_select ON chat_participant;
CREATE POLICY chat_participant_select ON chat_participant
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR public.is_chat_participant(conversation_id)
    )
  );
