/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlCenterBike, ControlCenterData } from "@/lib/services/controlCenter";
import { CONTROL_CENTER_COLLAPSED_STORAGE_KEY } from "@/lib/control-center/collapsedSections";
import { ReadyForPickupCarousel } from "@/components/technician/ReadyForPickupCarousel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/database/supabase-browser", () => ({
  createClient: () => {
    const channel = {
      on() {
        return channel;
      },
      subscribe() {
        return channel;
      },
    };
    return {
      channel: () => channel,
      removeChannel: () => {},
    };
  },
}));

import { ControlCenterShell } from "@/components/control-center/ControlCenterShell";

const bike: ControlCenterBike = {
  work_order_id: "wo-1",
  work_order_number: "WO-100",
  status: "in_progress",
  date_created: "2026-10-30T12:00:00.000Z",
  opened_at: null,
  technician_id: "tech-1",
  customer_name: "Sam Rider",
  customer_phone: null,
  customer_email: null,
  customer_sms_opted_out: false,
  bike_title: "Ninja 400",
  primary_photo_url: null,
  stage_label: "In progress",
  stage_tone: "teal",
  flags: [],
  flag_badge: null,
  at_risk: false,
  status_dot: "green",
  last_job_activity_at: null,
};

const data: ControlCenterData = {
  location_id: "loc-tor",
  location_code: "TOR",
  role: "owner",
  subtitle: "Shop pulse",
  pool: [],
  techs: [
    {
      user_id: "tech-1",
      first_name: "Alex",
      last_name: "Rivera",
      role: "technician",
      availability: "busy",
      assigned_bikes: [bike],
    },
  ],
  kpis: [],
  live_summary: "1 bike",
};

function sectionToggle(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button[aria-expanded]")].find((button) =>
    button.textContent?.includes(label)
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Missing collapse control for ${label}`);
  }
  return match;
}

describe("control center collapsible sections", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
  });

  async function renderBoard() {
    await act(async () => {
      root.render(
        createElement(ControlCenterShell, {
          data,
          canAssign: true,
          waitingForApproval: [],
          waitingForParts: [],
          insuranceBikes: [],
        })
      );
    });
  }

  it("shrinks and expands each section without affecting the others", async () => {
    await renderBoard();

    for (const label of [
      "Waiting for tech",
      "Alex Rivera",
      "Waiting for approval",
      "Waiting for parts",
      "Final inspection",
      "Ready for safety",
      "Ready for pickup",
      "Storage",
      "Complete",
      "Insurance bikes",
    ]) {
      expect(sectionToggle(container, label).getAttribute("aria-expanded")).toBe("true");
    }

    expect(container.textContent).toContain("All bikes are dispatched");
    expect(container.textContent).toContain("Ninja 400");
    expect(container.textContent).toContain("No insurance bikes.");

    expect(sectionToggle(container, "Waiting for tech").textContent?.trim()).toBe(
      "Waiting for tech"
    );
    expect(sectionToggle(container, "Waiting for approval").textContent?.trim()).toBe(
      "Waiting for approval"
    );
    expect(
      sectionToggle(container, "Alex Rivera")
        .querySelector(".cc-tech-avatar")
        ?.getAttribute("aria-hidden")
    ).toBe("true");

    await act(async () => {
      sectionToggle(container, "Insurance bikes").click();
    });

    expect(
      sectionToggle(container, "Insurance bikes").getAttribute("aria-expanded")
    ).toBe("false");
    expect(container.textContent).not.toContain("No insurance bikes.");
    expect(container.textContent).toContain("No bikes waiting for approval.");
    expect(container.textContent).toContain("Ninja 400");
    expect(window.localStorage.getItem(CONTROL_CENTER_COLLAPSED_STORAGE_KEY)).toContain(
      "insurance"
    );

    await act(async () => {
      sectionToggle(container, "Alex Rivera").click();
    });
    expect(container.textContent).not.toContain("Ninja 400");
    expect(container.textContent).toContain("1 bike");

    await act(async () => {
      sectionToggle(container, "Waiting for tech").click();
    });
    expect(container.textContent).not.toContain("All bikes are dispatched");

    await act(async () => {
      sectionToggle(container, "Insurance bikes").click();
    });
    expect(container.textContent).toContain("No insurance bikes.");
    expect(
      sectionToggle(container, "Waiting for tech").getAttribute("aria-expanded")
    ).toBe("false");
  });

  it("restores collapsed sections after a reload", async () => {
    window.localStorage.setItem(
      CONTROL_CENTER_COLLAPSED_STORAGE_KEY,
      JSON.stringify({ insurance: true, "tech:tech-1": true })
    );
    await renderBoard();

    expect(
      sectionToggle(container, "Insurance bikes").getAttribute("aria-expanded")
    ).toBe("false");
    expect(container.textContent).not.toContain("No insurance bikes.");
    expect(container.textContent).not.toContain("Ninja 400");
    expect(
      sectionToggle(container, "Waiting for parts").getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("leaves the technician floor pickup row expanded with no toggle", async () => {
    await act(async () => {
      root.render(createElement(ReadyForPickupCarousel, { items: [] }));
    });
    expect(container.querySelector("button[aria-expanded]")).toBeNull();
    expect(container.textContent).toContain("No bikes waiting for pickup.");
  });

  // Last on purpose: a refused write leaves the module on its in-memory
  // fallback for the rest of this page load.
  it("still collapses when the browser refuses to store the choice", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    try {
      await renderBoard();

      await act(async () => {
        sectionToggle(container, "Storage").click();
      });

      expect(sectionToggle(container, "Storage").getAttribute("aria-expanded")).toBe(
        "false"
      );
      expect(container.textContent).not.toContain("No bikes in storage.");
      expect(
        window.localStorage.getItem(CONTROL_CENTER_COLLAPSED_STORAGE_KEY)
      ).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });
});
