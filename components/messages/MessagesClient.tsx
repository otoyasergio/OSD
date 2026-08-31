"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessengerShell } from "@/components/messages/MessengerShell";
import { ChatThread } from "@/components/messages/ChatThread";
import { CallsPane } from "@/components/messages/CallsPane";
import { createClient } from "@/lib/database/supabase-browser";
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
  const router = useRouter();
  const [tab, setTab] = useState<"chats" | "calls">("chats");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`inbox:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversation" },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_message" },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_participant" },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, router]);

  const showCalls = tab === "calls" && !activeConversationId;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          className={tab === "chats" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("chats")}
        >
          Chats
        </button>
        <button
          type="button"
          className={tab === "calls" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("calls")}
        >
          Calls
        </button>
      </div>
      <MessengerShell
        conversations={conversations}
        currentUserId={currentUserId}
        activeConversationId={activeConversationId}
      >
        {showCalls ? (
          <CallsPane />
        ) : conversation && messages ? (
          <ChatThread
            conversation={conversation}
            initialMessages={messages}
            currentUserId={currentUserId}
          />
        ) : null}
      </MessengerShell>
    </div>
  );
}
