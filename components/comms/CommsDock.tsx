"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/database/supabase-browser";
import { loadCommsSnapshotAction } from "@/app/(app)/messages/voice-actions";
import { useShopVoiceOptional } from "@/components/comms/ShopVoiceProvider";

type Recent = {
  conversation_id: string;
  display_name: string;
  last_message_preview: string | null;
  unread: boolean;
};

type Snapshot = {
  unreadCount: number;
  recents: Recent[];
  onlineUserIds: string[];
};

const CommsSnapshotContext = createContext<Snapshot | null>(null);

export function useCommsSnapshot(): Snapshot | null {
  return useContext(CommsSnapshotContext);
}

export function CommsSnapshotProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    unreadCount: 0,
    recents: [],
    onlineUserIds: [],
  });

  const refresh = useCallback(async () => {
    const result = await loadCommsSnapshotAction();
    if (result.error) return;
    setSnapshot({
      unreadCount: result.unreadCount ?? 0,
      recents: result.recents ?? [],
      onlineUserIds: result.onlineUserIds ?? [],
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount snapshot
    void refresh();
    const supabase = createClient();
    const channel = supabase
      .channel(`comms-dock:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_message" },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversation" },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_participant" },
        () => {
          void refresh();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return (
    <CommsSnapshotContext.Provider value={snapshot}>
      {children}
    </CommsSnapshotContext.Provider>
  );
}

export function CommsDock() {
  const snapshot = useCommsSnapshot();
  const voice = useShopVoiceOptional();
  const [open, setOpen] = useState(false);
  const unread = snapshot?.unreadCount ?? 0;

  return (
    <div className={`comms-dock${open ? " comms-dock--open" : ""}`}>
      <button
        type="button"
        className="comms-dock-chip"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Messages
        {unread > 0 ? (
          <span className="comms-unread-badge" aria-label={`${unread} unread`}>
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
        {voice?.active ? <span className="comms-dock-live">On a call</span> : null}
      </button>
      {open ? (
        <div className="comms-dock-panel">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p className="text-sm font-semibold">Communication</p>
            <Link href="/messages" className="text-xs underline-offset-2 hover:underline">
              Open hub
            </Link>
          </div>
          {voice?.active ? (
            <p className="border-b border-[var(--border)] px-3 py-2 text-sm">
              Live: {voice.active.label}
            </p>
          ) : null}
          <ul>
            {(snapshot?.recents ?? []).map((row) => (
              <li key={row.conversation_id}>
                <Link
                  href={`/messages/${row.conversation_id}`}
                  className="block border-b border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-muted)]"
                  onClick={() => setOpen(false)}
                >
                  <span className={`block text-sm ${row.unread ? "font-semibold" : ""}`}>
                    {row.display_name}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {row.last_message_preview ?? "No messages yet"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {(snapshot?.recents ?? []).length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">No recent chats.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
