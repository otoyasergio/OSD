"use client";

import { useCallback, useState } from "react";
import { MessengerShell } from "@/components/messages/MessengerShell";
import { CallOverlay } from "@/components/messages/CallOverlay";
import { ChatThread } from "@/components/messages/ChatThread";
import type { ChatMessage, Conversation } from "@/lib/services/messenger";

type Props = {
  conversations: Conversation[];
  currentUserId: string;
  activeConversationId?: string | null;
  conversation?: Conversation;
  messages?: ChatMessage[];
};

export function MessagesClient({
  conversations,
  currentUserId,
  activeConversationId,
  conversation,
  messages,
}: Props) {
  const [outgoingCall, setOutgoingCall] = useState<{
    callId: string;
    kind: "audio" | "video";
  } | null>(null);

  const clearOutgoing = useCallback(() => setOutgoingCall(null), []);

  return (
    <>
      <MessengerShell
        conversations={conversations}
        currentUserId={currentUserId}
        activeConversationId={activeConversationId}
      >
        {conversation && messages ? (
          <ChatThread
            conversation={conversation}
            initialMessages={messages}
            currentUserId={currentUserId}
            onStartCall={(callId, kind) => {
              setOutgoingCall({ callId, kind });
            }}
          />
        ) : null}
      </MessengerShell>
      <CallOverlay
        currentUserId={currentUserId}
        outgoingCall={outgoingCall}
        onOutgoingHandled={clearOutgoing}
      />
    </>
  );
}
