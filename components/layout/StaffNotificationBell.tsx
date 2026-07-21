"use client";

import { Bell, CheckCheck } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { StaffAssignmentNotification } from "@/lib/services/staffNotifications";

type Props = {
  notifications: StaffAssignmentNotification[];
  open: boolean;
  busy: boolean;
  error: string | null;
  onToggle: () => void;
  onOpenNotification: (notification: StaffAssignmentNotification) => void;
  onMarkAllRead: () => void;
};

type PanelCoords = {
  top: number;
  right: number;
  maxHeight: number;
};

export function StaffNotificationBell({
  notifications,
  open,
  busy,
  error,
  onToggle,
  onOpenNotification,
  onMarkAllRead,
}: Props) {
  const unreadCount = notifications.length;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [coords, setCoords] = useState<PanelCoords | null>(null);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setCoords(null);
      return;
    }

    function updatePosition() {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const gap = 8;
      const top = rect.bottom + gap;
      const right = Math.max(8, window.innerWidth - rect.right);
      const maxHeight = Math.max(12 * 16, window.innerHeight - top - 16);
      setCoords({ top, right, maxHeight });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onToggle();
    }

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onToggle();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open, onToggle]);

  const panel =
    open && mounted && coords
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Assignment alerts"
            className="staff-notification-panel"
            style={{
              top: coords.top,
              right: coords.right,
              maxHeight: coords.maxHeight,
            }}
          >
            <div className="staff-notification-panel-header">
              <div>
                <p className="font-semibold">Assignment alerts</p>
                <p className="text-xs text-muted-foreground">
                  New motorcycles added to your docket
                </p>
              </div>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                  disabled={busy}
                  onClick={onMarkAllRead}
                >
                  <CheckCheck size={15} aria-hidden />
                  Mark all seen
                </button>
              ) : null}
            </div>

            {error ? (
              <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
                {error}
              </p>
            ) : null}

            {unreadCount === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                You are all caught up.
              </p>
            ) : (
              <ul className="staff-notification-panel-list">
                {notifications.map((notification) => (
                  <li key={notification.notification_id}>
                    <button
                      type="button"
                      className="block w-full px-4 py-3 text-left transition hover:bg-muted/60 disabled:opacity-60"
                      disabled={busy}
                      onClick={() => onOpenNotification(notification)}
                    >
                      <span className="block text-sm font-semibold">
                        New motorcycle assignment
                      </span>
                      <span className="mt-0.5 block text-sm text-foreground">
                        {notification.work_order_number} · {notification.motorcycle_label}
                      </span>
                      {notification.actor_name ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Assigned by {notification.actor_name}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-chrome-border bg-chrome-elevated text-chrome-foreground transition hover:border-slate-600 hover:bg-slate-800"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread assignment ${unreadCount === 1 ? "alert" : "alerts"}`
            : "Assignment alerts"
        }
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
      >
        <Bell size={19} aria-hidden />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>
      {panel}
    </div>
  );
}
