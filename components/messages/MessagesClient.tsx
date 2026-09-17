"use client";

import { useEffect, useState } from "react";
import { MessengerShell } from "@/components/messages/MessengerShell";
import { ChatThread } from "@/components/messages/ChatThread";
import { CallsPane } from "@/components/messages/CallsPane";
import { createClient } from "@/lib/database/supabase-browser";
import { useDebouncedRouterRefresh } from "@/lib/client/useDebouncedRouterRefresh";
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
  const [tab, setTab] = useState<"chats" | "calls">("chats");
  // Coalesce realtime bursts: each refresh re-runs the full inbox + thread +
  // attachment signing server-side, so raw per-event refreshes stack up fast.
  const { schedule: scheduleRefresh } = useDebouncedRouterRefresh({ delayMs: 800 });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`inbox:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversation" },
        () => scheduleRefresh()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_message" },
        () => scheduleRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_participant" },
        () => scheduleRefresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, scheduleRefresh]);

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
