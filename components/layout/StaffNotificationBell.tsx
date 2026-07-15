import { Bell, CheckCheck } from "lucide-react";
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

  return (
    <div className="relative">
      <button
        type="button"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-chrome-border bg-chrome-elevated text-chrome-foreground transition hover:border-slate-600 hover:bg-slate-800"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread assignment ${unreadCount === 1 ? "alert" : "alerts"}`
            : "Assignment alerts"
        }
        aria-expanded={open}
        onClick={onToggle}
      >
        <Bell size={19} aria-hidden />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
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
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
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
        </div>
      ) : null}
    </div>
  );
}
