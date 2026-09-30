import { describe, expect, it, vi } from "vitest";
import { registerStaffNotificationRealtime } from "@/lib/staffNotifications/realtime";

describe("staff notification Realtime registration", () => {
  it("filters only INSERT and UPDATE events for the current recipient", () => {
    const registrations: Array<Record<string, unknown>> = [];
    const channel = {
      on: vi.fn(
        (_kind: string, filter: Record<string, unknown>, _callback: () => void) => {
          registrations.push(filter);
          return channel;
        }
      ),
    };

    const callback = vi.fn();
    expect(registerStaffNotificationRealtime(channel, "user-123", callback)).toBe(
      channel
    );
    expect(registrations).toEqual([
      {
        event: "INSERT",
        schema: "public",
        table: "staff_notification",
        filter: "recipient_user_id=eq.user-123",
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "staff_notification",
        filter: "recipient_user_id=eq.user-123",
      },
    ]);
    expect(registrations).not.toContainEqual(expect.objectContaining({ event: "*" }));
  });
});
