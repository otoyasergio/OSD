/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffNotificationBell } from "@/components/layout/StaffNotificationBell";
import {
  formatNotificationAge,
  motorcycleNotificationLabel,
} from "@/lib/services/staffNotifications";
import { staffAssignmentHref } from "@/lib/technician/assignmentHref";

const SAMPLE_NOTIFICATION = {
  notification_id: "notification-1",
  kind: "work_order_assigned" as const,
  work_order_id: "work-order-1",
  work_order_number: "WO-1042",
  motorcycle_label: "2024 Honda CB650R",
  actor_name: "Alex Advisor",
  created_at: "2026-07-15T17:45:00.000Z",
};

function bellProps(overrides: Partial<Parameters<typeof StaffNotificationBell>[0]> = {}) {
  return {
    notifications: [SAMPLE_NOTIFICATION],
    open: true,
    busy: false,
    error: null,
    onToggle: () => undefined,
    onOpenNotification: () => undefined,
    onMarkAllRead: () => undefined,
    ...overrides,
  };
}

function stubMatchMedia(mobileMatches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobileMatches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("staff assignment notifications", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    // jsdom has no matchMedia by default — remove any stub we installed.
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  function mount(element: React.ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(element);
    });
  }

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
    mount(createElement(StaffNotificationBell, bellProps()));

    const markup = document.body.innerHTML;
    expect(markup).toContain('aria-label="1 unread assignment alert"');
    expect(markup).toContain("WO-1042 · 2024 Honda CB650R");
    expect(markup).toContain("Assigned by Alex Advisor");
    expect(markup).toContain("Mark all seen");
  });

  it("closes on Escape", () => {
    const onToggle = vi.fn();
    mount(createElement(StaffNotificationBell, bellProps({ onToggle })));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("closes on outside pointer-down but not on clicks inside the panel", () => {
    const onToggle = vi.fn();
    mount(createElement(StaffNotificationBell, bellProps({ onToggle })));

    const panel = document.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
    act(() => {
      panel!
        .querySelector("p")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onToggle).not.toHaveBeenCalled();

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the bell button when the dialog closes", () => {
    mount(createElement(StaffNotificationBell, bellProps({ open: true })));
    act(() => {
      root!.render(createElement(StaffNotificationBell, bellProps({ open: false })));
    });
    const active = document.activeElement as HTMLElement | null;
    expect(active?.getAttribute("aria-label")).toBe("1 unread assignment alert");
  });

  it("renders exactly one dialog when both responsive slots share one controller", () => {
    stubMatchMedia(true); // mobile viewport
    const onToggle = vi.fn();
    mount(
      createElement(
        "div",
        null,
        createElement(StaffNotificationBell, bellProps({ onToggle, slot: "mobile" })),
        createElement(StaffNotificationBell, bellProps({ onToggle, slot: "desktop" }))
      )
    );

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    // Only the visible slot owns document listeners — Escape toggles once,
    // so the dialog actually closes instead of double-toggling back open.
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(onToggle).toHaveBeenCalledTimes(1);

    const expandedButtons = [...document.querySelectorAll("button")].filter(
      (button) => button.getAttribute("aria-expanded") === "true"
    );
    expect(expandedButtons).toHaveLength(1);
  });

  it("renders the desktop slot dialog on wide viewports", () => {
    stubMatchMedia(false); // desktop viewport
    mount(
      createElement(
        "div",
        null,
        createElement(StaffNotificationBell, bellProps({ slot: "mobile" })),
        createElement(StaffNotificationBell, bellProps({ slot: "desktop" }))
      )
    );
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
