"use client";

import { useState, useTransition } from "react";
import type { ChatMessage, ConversationParticipant } from "@/lib/services/messenger";
import {
  editMessageAction,
  toggleReactionAction,
  unsendMessageAction,
} from "@/app/(app)/messages/actions";
import { canUnsendMessage } from "@/lib/messenger/unsendWindow";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

type Props = {
  message: ChatMessage;
  currentUserId: string;
  conversationId: string;
  participants: ConversationParticipant[];
  onReply: (message: ChatMessage) => void;
};

function receiptLabel(
  message: ChatMessage,
  currentUserId: string,
  participants: ConversationParticipant[]
): string | null {
  if (message.sender_user_id !== currentUserId) return null;
  const others = participants.filter((p) => p.user_id !== currentUserId);
  if (others.length === 0) return "Delivered";
  const created = new Date(message.created_at).getTime();
  const allRead = others.every(
    (p) => p.last_read_at && new Date(p.last_read_at).getTime() >= created
  );
  if (allRead) return others.length > 1 ? `Read by ${others.length}` : "Read";
  return "Delivered";
}

export function MessageBubble({
  message,
  currentUserId,
  conversationId,
  participants,
  onReply,
}: Props) {
  const mine = message.sender_user_id === currentUserId;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reactionGroups = new Map<string, number>();
  for (const r of message.reactions) {
    reactionGroups.set(r.emoji, (reactionGroups.get(r.emoji) ?? 0) + 1);
  }

  if (message.kind === "system" || message.kind === "call_event") {
    return <div className="my-3 text-center text-xs text-slate-500">{message.body}</div>;
  }

  if (message.unsent_at) {
    return (
      <div className={`mb-2 flex ${mine ? "justify-end" : "justify-start"}`}>
        <div className="rounded-2xl bg-[var(--surface-muted)] px-3 py-2 text-sm italic text-slate-500">
          Message unsent
        </div>
      </div>
    );
  }

  const receipt = receiptLabel(message, currentUserId, participants);

  return (
    <div className={`mb-2 flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%] sm:max-w-[70%]">
        {!mine && message.sender ? (
          <div className="mb-0.5 px-1 text-xs text-slate-500">
            {message.sender.first_name}
          </div>
        ) : null}
        <div
          className={`relative rounded-2xl px-3 py-2 text-sm shadow-sm ${
            mine
              ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
              : "bg-[var(--surface-muted)] text-slate-900"
          }`}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen((v) => !v);
          }}
          onDoubleClick={() => setMenuOpen((v) => !v)}
        >
          {message.reply_to ? (
            <div
              className={`mb-1 border-l-2 pl-2 text-xs opacity-80 ${
                mine ? "border-black/30" : "border-slate-400"
              }`}
            >
              {message.reply_to.body ??
                (message.reply_to.kind === "image" ? "Photo" : "Message")}
            </div>
          ) : null}

          {editing ? (
            <div className="space-y-2">
              <textarea
                className="input w-full text-sm text-slate-900"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary text-xs"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await editMessageAction(
                        conversationId,
                        message.message_id,
                        editBody
                      );
                      if (result.error) setError(result.error);
                      else setEditing(false);
                    });
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn text-xs"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {message.kind === "image" && message.attachments[0]?.signed_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={message.attachments[0].signed_url}
                  alt="Shared photo"
                  className="max-h-64 rounded-lg"
                />
              ) : message.kind === "audio" && message.attachments[0]?.signed_url ? (
                <audio
                  controls
                  src={message.attachments[0].signed_url}
                  className="max-w-full"
                />
              ) : (
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
              )}
              {message.edited_at ? (
                <span className="mt-1 block text-[10px] opacity-70">Edited</span>
              ) : null}
            </>
          )}

          {menuOpen ? (
            <div className="absolute bottom-full left-0 z-20 mb-1 min-w-[10rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-slate-800 shadow-lg">
              <div className="mb-2 flex gap-1">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="rounded p-1 hover:bg-[var(--surface-muted)]"
                    onClick={() => {
                      startTransition(async () => {
                        await toggleReactionAction(
                          conversationId,
                          message.message_id,
                          emoji
                        );
                        setMenuOpen(false);
                      });
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--surface-muted)]"
                onClick={() => {
                  onReply(message);
                  setMenuOpen(false);
                }}
              >
                Reply
              </button>
              {mine && message.kind === "text" ? (
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--surface-muted)]"
                  onClick={() => {
                    setEditing(true);
                    setMenuOpen(false);
                  }}
                >
                  Edit
                </button>
              ) : null}
              {mine && canUnsendMessage(message.created_at) ? (
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-sm text-[var(--status-danger-fg)] hover:bg-[var(--surface-muted)]"
                  onClick={() => {
                    startTransition(async () => {
                      const result = await unsendMessageAction(
                        conversationId,
                        message.message_id
                      );
                      if (result.error) setError(result.error);
                      setMenuOpen(false);
                    });
                  }}
                >
                  Unsend
                </button>
              ) : null}
              <button
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--surface-muted)]"
                onClick={() => setMenuOpen(false)}
              >
                Close
              </button>
            </div>
          ) : null}
        </div>

        {reactionGroups.size > 0 ? (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
            {[...reactionGroups.entries()].map(([emoji, count]) => (
              <button
                key={emoji}
                type="button"
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs"
                onClick={() => {
                  startTransition(async () => {
                    await toggleReactionAction(conversationId, message.message_id, emoji);
                  });
                }}
              >
                {emoji} {count}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={`mt-0.5 px-1 text-[10px] text-slate-500 ${mine ? "text-right" : ""}`}
        >
          {new Date(message.created_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
          {receipt ? ` · ${receipt}` : ""}
        </div>
        {error ? (
          <p className="mt-1 text-xs text-[var(--status-danger-fg)]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
