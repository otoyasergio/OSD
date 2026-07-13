"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Phone, Video, Pin, BellOff, Trash2, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/database/supabase-browser";
import type { ChatMessage, Conversation } from "@/lib/services/messenger";
import { MessageBubble } from "@/components/messages/MessageBubble";
import { Composer } from "@/components/messages/Composer";
import {
  hideConversationAction,
  markReadAction,
  setMutedAction,
  setPinnedAction,
  startCallAction,
} from "@/app/(app)/messages/actions";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Props = {
  conversation: Conversation;
  initialMessages: ChatMessage[];
  currentUserId: string;
  onStartCall?: (callId: string, kind: "audio" | "video") => void;
};

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function ChatThread({
  conversation,
  initialMessages,
  currentUserId,
  onStartCall,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [replyTo, setReplyTo] = useState<{
    message_id: string;
    preview: string;
  } | null>(null);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const self = conversation.participants.find((p) => p.user_id === currentUserId);
  const pinned = Boolean(self?.pinned_at);
  const muted = Boolean(self?.muted_at);

  useEffect(() => {
    // Sync after revalidatePath / router.refresh for edits, reactions, attachments.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional server→client sync
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    startTransition(async () => {
      await markReadAction(conversation.conversation_id);
    });
  }, [conversation.conversation_id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`conversation:${conversation.conversation_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_message",
          filter: `conversation_id=eq.${conversation.conversation_id}`,
        },
        (payload) => {
          const row = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.message_id === row.message_id)) return prev;
            return [
              ...prev,
              {
                ...row,
                reactions: [],
                attachments: [],
                sender: null,
                reply_to: null,
              },
            ];
          });
          if (row.sender_user_id !== currentUserId) {
            void markReadAction(conversation.conversation_id);
          }
          if (row.kind === "image" || row.kind === "audio" || row.kind === "call_event") {
            router.refresh();
          }
        }
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const userId = (payload as { user_id?: string })?.user_id;
        if (!userId || userId === currentUserId) return;
        setTypingUser(userId);
        window.setTimeout(() => setTypingUser(null), 3000);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversation.conversation_id, currentUserId, router]);

  const typingName = useMemo(() => {
    if (!typingUser) return null;
    const p = conversation.participants.find((x) => x.user_id === typingUser);
    return p ? p.first_name : "Someone";
  }, [typingUser, conversation.participants]);

  const grouped = useMemo(() => {
    const items: Array<
      | { type: "day"; key: string; label: string }
      | { type: "message"; message: ChatMessage }
    > = [];
    let lastDay: string | null = null;
    for (const message of messages) {
      const key = dayKey(message.created_at);
      if (key !== lastDay) {
        items.push({ type: "day", key, label: dayLabel(message.created_at) });
        lastDay = key;
      }
      items.push({ type: "message", message });
    }
    return items;
  }, [messages]);

  function broadcastTyping() {
    if (typingTimerRef.current) return;
    typingTimerRef.current = setTimeout(() => {
      typingTimerRef.current = null;
    }, 1500);
    const channel = channelRef.current;
    if (!channel) return;
    void channel.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: currentUserId },
    });
  }

  function placeCall(kind: "audio" | "video") {
    setCallError(null);
    startTransition(async () => {
      const result = await startCallAction(conversation.conversation_id, kind);
      if (result.error || !result.callId) {
        setCallError(result.error ?? "Could not start call.");
        return;
      }
      onStartCall?.(result.callId, kind);
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Link
          href="/messages"
          className="btn md:hidden"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{conversation.display_name}</h2>
          {typingName ? (
            <p className="text-xs text-slate-500">{typingName} is typing…</p>
          ) : (
            <p className="truncate text-xs text-slate-500">
              {conversation.participants
                .map((p) => `${p.first_name} ${p.last_name}`)
                .join(", ")}
            </p>
          )}
          {callError ? (
            <p className="text-xs text-[var(--status-danger-fg)]">{callError}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="btn"
          disabled={pending}
          title="Audio call"
          onClick={() => placeCall("audio")}
        >
          <Phone className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn"
          disabled={pending}
          title="Video call"
          onClick={() => placeCall("video")}
        >
          <Video className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn"
          title={pinned ? "Unpin" : "Pin"}
          onClick={() => {
            startTransition(async () => {
              await setPinnedAction(conversation.conversation_id, !pinned);
              router.refresh();
            });
          }}
        >
          <Pin className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn"
          title={muted ? "Unmute" : "Mute"}
          onClick={() => {
            startTransition(async () => {
              await setMutedAction(conversation.conversation_id, !muted);
              router.refresh();
            });
          }}
        >
          <BellOff className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn"
          title="Delete for me"
          onClick={() => {
            startTransition(async () => {
              await hideConversationAction(conversation.conversation_id);
              router.push("/messages");
            });
          }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4" onKeyDown={broadcastTyping}>
        {grouped.map((item) =>
          item.type === "day" ? (
            <div
              key={`day-${item.key}`}
              className="my-4 text-center text-xs font-medium text-slate-500"
            >
              {item.label}
            </div>
          ) : (
            <MessageBubble
              key={item.message.message_id}
              message={item.message}
              currentUserId={currentUserId}
              conversationId={conversation.conversation_id}
              participants={conversation.participants}
              onReply={(m) =>
                setReplyTo({
                  message_id: m.message_id,
                  preview: m.body ?? (m.kind === "image" ? "Photo" : "Message"),
                })
              }
            />
          )
        )}
        <div ref={bottomRef} />
      </div>

      <div onInput={broadcastTyping}>
        <Composer
          conversationId={conversation.conversation_id}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
        />
      </div>
    </div>
  );
}
