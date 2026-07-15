import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaffNotificationBell } from "@/components/layout/StaffNotificationBell";
import {
  formatNotificationAge,
  motorcycleNotificationLabel,
} from "@/lib/services/staffNotifications";
import { staffAssignmentHref } from "@/lib/technician/assignmentHref";

describe("staff assignment notifications", () => {
  it("formats the assigned motorcycle for a quick scan", () => {
    expect(
      motorcycleNotificationLabel({ year: 2024, make: "Honda", model: "CB650R" })
    ).toBe("2024 Honda CB650R");
    expect(motorcycleNotificationLabel(null)).toBe("Motorcycle");
  });

  it("formats compact notification ages", () => {
    const now = Date.parse("2026-07-15T18:00:00.000Z");
    expect(formatNotificationAge("2026-07-15T17:59:40.000Z", now)).toBe("Just now");
    expect(formatNotificationAge("2026-07-15T17:45:00.000Z", now)).toBe("15m ago");
    expect(formatNotificationAge("2026-07-15T15:00:00.000Z", now)).toBe("3h ago");
    expect(formatNotificationAge("2026-07-13T18:00:00.000Z", now)).toBe("2d ago");
  });

  it("opens an assignment on the exact motorcycle in the tech floor", () => {
    expect(staffAssignmentHref("work order/1")).toBe("/technician?wo=work%20order%2F1");
  });

  it("renders a scannable unread assignment in the bell menu", () => {
    const markup = renderToStaticMarkup(
      StaffNotificationBell({
        notifications: [
          {
            notification_id: "notification-1",
            kind: "work_order_assigned",
            work_order_id: "work-order-1",
            work_order_number: "WO-1042",
            motorcycle_label: "2024 Honda CB650R",
            actor_name: "Alex Advisor",
            created_at: "2026-07-15T17:45:00.000Z",
          },
        ],
        open: true,
        busy: false,
        error: null,
        onToggle: () => undefined,
        onOpenNotification: () => undefined,
        onMarkAllRead: () => undefined,
      })
    );

    expect(markup).toContain('aria-label="1 unread assignment alert"');
    expect(markup).toContain("WO-1042 · 2024 Honda CB650R");
    expect(markup).toContain("Assigned by Alex Advisor");
    expect(markup).toContain("Mark all seen");
  });
});
