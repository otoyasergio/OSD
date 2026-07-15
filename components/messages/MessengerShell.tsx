"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Conversation } from "@/lib/services/messenger";
import { ConversationList } from "@/components/messages/ConversationList";
import { searchMessagesAction } from "@/app/(app)/messages/actions";

type Props = {
  conversations: Conversation[];
  currentUserId: string;
  activeConversationId?: string | null;
  children?: React.ReactNode;
};

export function MessengerShell({
  conversations,
  currentUserId,
  activeConversationId,
  children,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<
    Array<{
      message_id: string;
      conversation_id: string;
      body: string | null;
      conversation_display_name: string;
    }>
  >([]);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showThreadOnly = Boolean(activeConversationId);

  const listPaneClass = useMemo(
    () =>
      `flex w-full flex-col border-r border-[var(--border)] md:w-80 lg:w-96 ${
        showThreadOnly ? "hidden md:flex" : "flex"
      }`,
    [showThreadOnly]
  );

  const threadPaneClass = useMemo(
    () => `min-w-0 flex-1 flex-col ${showThreadOnly ? "flex" : "hidden md:flex"}`,
    [showThreadOnly]
  );

  function onSearch(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setHits([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await searchMessagesAction(value);
        if (!result.error && result.hits) setHits(result.hits);
      });
    }, 300);
  }

  return (
    <div className="messenger-shell flex min-h-[calc(100vh-5rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <aside className={listPaneClass}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Messages</h1>
          <div className="flex gap-2">
            <Link href="/messages/directory" className="btn text-sm">
              Directory
            </Link>
            <Link href="/messages/new" className="btn btn-primary text-sm">
              New
            </Link>
          </div>
        </div>
        <div className="border-b border-[var(--border)] px-3 py-2">
          <input
            className="input w-full text-sm"
            placeholder="Search messages"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        {query.trim() && hits.length > 0 ? (
          <div className="flex-1 overflow-y-auto">
            {hits.map((hit) => (
              <button
                key={hit.message_id}
                type="button"
                className="block w-full border-b border-[var(--border)] px-4 py-3 text-left hover:bg-[var(--surface-muted)]"
                onClick={() => {
                  setQuery("");
                  setHits([]);
                  router.push(`/messages/${hit.conversation_id}`);
                }}
              >
                <div className="text-sm font-medium">{hit.conversation_display_name}</div>
                <div className="truncate text-sm text-slate-500">{hit.body}</div>
              </button>
            ))}
            {pending ? <p className="p-3 text-xs text-slate-500">Searching…</p> : null}
          </div>
        ) : (
          <ConversationList
            conversations={conversations}
            activeConversationId={activeConversationId}
            currentUserId={currentUserId}
          />
        )}
      </aside>
      <section className={threadPaneClass}>
        {children ?? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
            Select a conversation
          </div>
        )}
      </section>
    </div>
  );
}
