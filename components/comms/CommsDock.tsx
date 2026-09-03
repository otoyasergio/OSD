"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";
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
    // This provider is mounted on every staff page, so coalesce realtime
    // bursts: N online users x M chat events would otherwise fan out one
    // snapshot server action per event per user.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSnapshotRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 1000);
    };
    const supabase = createClient();
    const channel = supabase
      .channel(`comms-dock:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_message" },
        scheduleSnapshotRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversation" },
        scheduleSnapshotRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_participant" },
        scheduleSnapshotRefresh
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return (
    <CommsSnapshotContext.Provider value={snapshot}>
      {children}
    </CommsSnapshotContext.Provider>
  );
}

export type CommsDockSlot = "mobile" | "desktop" | "floor";

const MOBILE_MEDIA_QUERY = "(max-width: 767.98px)";

function useSlotVisible(slot: CommsDockSlot): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (slot === "floor" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    () => {
      if (slot === "floor") return true;
      if (typeof window.matchMedia !== "function") return slot === "desktop";
      const mobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
      return slot === "mobile" ? mobile : !mobile;
    },
    () => slot !== "mobile"
  );
}

type Props = {
  /**
   * Responsive slot this dock lives in. The shell mounts one control in the
   * mobile header and one in the desktop topbar; only the visible slot owns
   * the recents panel so a duplicate dialog cannot appear.
   */
  slot: CommsDockSlot;
};

export function CommsDock({ slot }: Props) {
  const snapshot = useCommsSnapshot();
  const voice = useShopVoiceOptional();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const unread = snapshot?.unreadCount ?? 0;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const slotVisible = useSlotVisible(slot);
  const active = open && slotVisible;
  const messagesActive = pathname === "/messages" || pathname.startsWith("/messages/");

  useEffect(() => {
    if (!active) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [active]);

  const unreadBadge =
    unread > 0 ? (
      <span className="comms-unread-badge" aria-label={`${unread} unread`}>
        {unread > 99 ? "99+" : unread}
      </span>
    ) : null;

  const trigger =
    slot === "desktop" ? (
      <button
        ref={buttonRef}
        type="button"
        className="comms-dock-chip"
        aria-expanded={active}
        aria-controls={active ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        Messages
        {unreadBadge}
        {voice?.active ? <span className="comms-dock-live">On a call</span> : null}
      </button>
    ) : (
      <button
        ref={buttonRef}
        type="button"
        className={
          slot === "floor"
            ? `pit-floor-topbar-link comms-dock-icon${
                messagesActive ? " pit-floor-topbar-link--active" : ""
              }`
            : "comms-dock-icon comms-dock-icon--header"
        }
        aria-label={
          unread > 0
            ? `${unread} unread ${unread === 1 ? "message" : "messages"}`
            : "Messages"
        }
        aria-expanded={active}
        aria-controls={active ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <MessageSquare size={slot === "floor" ? 22 : 19} aria-hidden />
        {unreadBadge}
        {voice?.active ? (
          <span className="comms-dock-live-dot" aria-label="On a call" />
        ) : null}
        {slot === "floor" ? <span className="sr-only">Messages</span> : null}
      </button>
    );

  return (
    <div className={`comms-dock comms-dock--${slot}${active ? " comms-dock--open" : ""}`}>
      {trigger}
      {active ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Messages"
          className="comms-dock-panel"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p className="text-sm font-semibold">Communication</p>
            <Link
              href="/messages"
              className="text-xs underline-offset-2 hover:underline"
              onClick={() => setOpen(false)}
            >
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
