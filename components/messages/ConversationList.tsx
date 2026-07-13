"use client";

import Link from "next/link";
import type { Conversation } from "@/lib/services/messenger";

type Props = {
  conversations: Conversation[];
  activeConversationId?: string | null;
  currentUserId: string;
};

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationList({
  conversations,
  activeConversationId,
  currentUserId,
}: Props) {
  const pinned = conversations.filter((c) =>
    c.participants.some((p) => p.user_id === currentUserId && p.pinned_at)
  );
  const pinnedIds = new Set(pinned.map((c) => c.conversation_id));
  const recent = conversations.filter((c) => !pinnedIds.has(c.conversation_id));

  function renderRow(c: Conversation) {
    const muted = c.participants.some((p) => p.user_id === currentUserId && p.muted_at);
    const active = c.conversation_id === activeConversationId;
    return (
      <Link
        key={c.conversation_id}
        href={`/messages/${c.conversation_id}`}
        className={`flex items-start gap-3 border-b border-[var(--border)] px-4 py-3 transition-colors ${
          active ? "bg-[var(--accent-muted)]" : "hover:bg-[var(--surface-muted)]"
        }`}
      >
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-sm font-semibold text-slate-700">
          {c.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`truncate text-sm ${c.unread ? "font-semibold" : "font-medium"}`}
            >
              {c.display_name}
              {muted ? (
                <span className="ml-1 text-xs font-normal text-slate-400">muted</span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-slate-500">
              {formatTime(c.last_message_at ?? c.created_at)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p
              className={`truncate text-sm ${c.unread ? "text-slate-800" : "text-slate-500"}`}
            >
              {c.last_message_preview ?? "No messages yet"}
            </p>
            {c.unread ? (
              <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent)]" />
            ) : null}
          </div>
        </div>
      </Link>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">
        No conversations yet. Open the directory to message someone.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {pinned.length > 0 ? (
        <div>
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pinned
          </div>
          {pinned.map(renderRow)}
        </div>
      ) : null}
      {recent.length > 0 ? (
        <div>
          {pinned.length > 0 ? (
            <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recent
            </div>
          ) : null}
          {recent.map(renderRow)}
        </div>
      ) : null}
    </div>
  );
}
