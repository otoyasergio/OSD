/** @vitest-environment jsdom */
import { createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectionDetail } from "@/lib/services/inspections";

const { saveInspectionResultAction, completeInspectionAction } = vi.hoisted(() => ({
  saveInspectionResultAction: vi.fn(),
  completeInspectionAction: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/app/(app)/work_orders/[work_order_id]/inspection/actions", () => ({
  saveInspectionResultAction,
  completeInspectionAction,
}));

vi.mock("@/components/inspections/SignOffPad", () => ({
  SignOffPad: ({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) => {
    useEffect(() => {
      onReadyChange?.(true);
    }, [onReadyChange]);
    return createElement("div", { "data-testid": "signature" });
  },
}));

import { InspectionChecklist } from "@/components/inspections/InspectionChecklist";

const RESULT = "f2222222-2222-4222-8222-222222222222";
const WORK_ORDER = "42222222-2222-4222-8222-222222222222";

function inspection(): InspectionDetail {
  return {
    inspection_id: "e2222222-2222-4222-8222-222222222222",
    work_order_id: WORK_ORDER,
    started_at: "2026-11-03T12:00:00.000Z",
    completed_at: null,
    completed_by_user_id: null,
    completed_by_name: null,
    signature_storage_path: null,
    signature_signed_url: null,
    location_id: "31111111-1111-4111-8111-111111111111",
    work_order_number: "WO-220",
    work_order_status: "inspection_in_progress",
    is_foreign_location: false,
    header: {
      customer_name: "QA Rider",
      motorcycle_label: "2020 Honda CB500",
      motorcycle: {
        motorcycle_id: "m2222222-2222-4222-8222-222222222222",
        year: 2020,
        make: "Honda",
        model: "CB500",
      },
      vin: "VIN222",
      mileage: 12000,
      mileage_unit: "km",
      technician_name: "QA Tech",
      date_created: "2026-11-03T12:00:00.000Z",
    },
    results: [
      {
        inspection_result_id: RESULT,
        inspection_id: "e2222222-2222-4222-8222-222222222222",
        template_item_id: "t2222222-2222-4222-8222-222222222222",
        category_snapshot: "Controls",
        item_name_snapshot: "Horn operation",
        display_order_snapshot: 1,
        requires_measurement_snapshot: true,
        status: "ok",
        measurement: null,
        notes: null,
        updated_by_user_id: null,
        updated_at: "2026-11-03T12:00:00.000Z",
      },
    ],
    incomplete_count: 1,
    missing_photos: [],
    photos: [],
  };
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
    input,
    value
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("inspection finish waits for the checklist save", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderReady() {
    await act(async () => {
      root.render(
        createElement(InspectionChecklist, {
          inspection: inspection(),
          canEdit: true,
          canForceComplete: false,
        })
      );
    });
    const input = container.querySelector(
      "input.inspection-measurement-input"
    ) as HTMLInputElement;
    await act(async () => {
      setInput(input, "12");
    });
  }

  function finishButton() {
    return [...container.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.includes("Sign and complete inspection") &&
        !button.classList.contains("sr-only")
    ) as HTMLButtonElement;
  }

  it("does not complete until the measurement just typed is saved", async () => {
    let releaseSave: (value: { ok: true }) => void = () => {};
    saveInspectionResultAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSave = resolve;
        })
    );

    await renderReady();
    const button = finishButton();
    expect(button.disabled).toBe(false);

    await act(async () => {
      button.click();
    });

    expect(saveInspectionResultAction).toHaveBeenCalled();
    expect(completeInspectionAction).not.toHaveBeenCalled();

    await act(async () => {
      releaseSave({ ok: true });
      await Promise.resolve();
    });

    expect(completeInspectionAction).toHaveBeenCalled();
  });

  it("stays open when the checklist save fails", async () => {
    saveInspectionResultAction.mockResolvedValue({
      ok: false,
      error: "Could not save this line",
    });

    await renderReady();
    await act(async () => {
      finishButton().click();
    });

    expect(container.textContent).toContain("Could not save this line");
    expect(completeInspectionAction).not.toHaveBeenCalled();
  });

  it("does not send a corrected measurement until the earlier save finishes", async () => {
    let releaseFirst: (value: { ok: true }) => void = () => {};
    const calls: Array<{ measurement?: string | null }> = [];
    saveInspectionResultAction.mockImplementation((_workOrder, _resultId, input) => {
      calls.push(input);
      if (calls.length === 1) {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve({ ok: true });
    });

    await renderReady();
    const input = container.querySelector(
      "input.inspection-measurement-input"
    ) as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.blur();
    });
    expect(calls.map((call) => call.measurement)).toEqual(["12"]);

    await act(async () => {
      setInput(input, "4.5");
    });
    await act(async () => {
      input.focus();
      input.blur();
    });

    // The corrected value must wait. An earlier request that finishes last
    // would otherwise overwrite 4.5mm with 12mm on the signed report.
    expect(saveInspectionResultAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst({ ok: true });
      await Promise.resolve();
    });

    expect(calls.map((call) => call.measurement)).toEqual(["12", "4.5"]);
  });
});
