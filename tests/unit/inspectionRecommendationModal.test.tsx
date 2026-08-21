/** @vitest-environment jsdom */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectionDetail } from "@/lib/services/inspections";
import type { InspectionResultStatus } from "@/lib/database/types";

const actionMocks = vi.hoisted(() => ({
  completeInspectionAction: vi.fn(async () => ({ error: null })),
  saveInspectionResultAction: vi.fn(async () => ({ ok: true, error: null })),
  saveInspectionRecommendationAction: vi.fn(async () => ({ error: null, saved: true })),
  getInspectionRecommendationDraftAction: vi.fn(),
}));

vi.mock("@/app/(app)/work_orders/[work_order_id]/inspection/actions", () => ({
  completeInspectionAction: actionMocks.completeInspectionAction,
  saveInspectionResultAction: actionMocks.saveInspectionResultAction,
}));

vi.mock("@/app/(app)/work_orders/recommendation-actions", () => ({
  saveInspectionRecommendationAction: actionMocks.saveInspectionRecommendationAction,
  getInspectionRecommendationDraftAction:
    actionMocks.getInspectionRecommendationDraftAction,
}));

vi.mock("@/components/inspections/InspectionPhotoSlot", () => ({
  InspectionPhotoSlot: () => <div data-testid="photo-slot" />,
}));

vi.mock("@/components/photos/PhotoLightbox", () => ({
  PhotoLightbox: () => null,
}));

import { InspectionRecommendationModal } from "@/components/inspections/InspectionRecommendationModal";
import { InspectionChecklist } from "@/components/inspections/InspectionChecklist";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
}

function currentDialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  );
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressKey(key: string, shiftKey = false) {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true })
    );
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  root = null;
  container = null;
  vi.clearAllMocks();
});

const result = {
  inspection_result_id: "10000000-0000-4000-8000-000000000001",
  inspection_id: "10000000-0000-4000-8000-000000000002",
  template_item_id: "10000000-0000-4000-8000-000000000003",
  category_snapshot: "Brakes & Tires",
  item_name_snapshot: "Front brake lining",
  display_order_snapshot: 1,
  requires_measurement_snapshot: true,
  status: "immediate_attention" as const,
  measurement: "1",
  notes: "Pads nearly worn",
  updated_by_user_id: null,
  updated_at: "2026-08-21T12:00:00.000Z",
};

function recommendationDraft(
  overrides: Partial<{
    description: string;
    severity: "future_attention" | "immediate_attention" | "safety_critical";
    notes: string;
  }> = {}
) {
  return {
    description: "Front brake lining (Brakes & Tires)",
    severity: "immediate_attention" as const,
    notes: "Pads nearly worn",
    ...overrides,
  };
}

function loadedRecommendationDraft(
  overrides: Parameters<typeof recommendationDraft>[0] = {}
) {
  return {
    draft: recommendationDraft(overrides),
    error: null,
  };
}

function inspectionDetail(overrides: Partial<InspectionDetail> = {}): InspectionDetail {
  return {
    inspection_id: result.inspection_id,
    work_order_id: "work-order-1",
    started_at: null,
    completed_at: null,
    completed_by_user_id: null,
    location_id: "location-1",
    work_order_number: "WO-1001",
    work_order_status: "inspection_in_progress",
    is_foreign_location: false,
    header: {
      customer_name: "Alex Rider",
      motorcycle_label: "2024 Honda CB650R",
      vin: "VIN-123",
      mileage: 1000,
      mileage_unit: "km",
      technician_name: "Taylor Tech",
      date_created: "2026-08-21T12:00:00.000Z",
    },
    results: [result],
    incomplete_count: 0,
    missing_photos: [],
    photos: [],
    ...overrides,
  };
}

async function openChecklistRecommendation(options?: {
  nextStatus?: Extract<
    InspectionResultStatus,
    "future_attention" | "immediate_attention"
  >;
  draftNotes?: string;
}) {
  const nextStatus = options?.nextStatus ?? "future_attention";
  const draftNotes = options?.draftNotes ?? "Local draft finding note";

  actionMocks.getInspectionRecommendationDraftAction.mockImplementation(
    async (workOrderId: string, inspectionResultId: string) =>
      loadedRecommendationDraft({
        description:
          workOrderId === "work-order-1" &&
          inspectionResultId === result.inspection_result_id
            ? `${result.item_name_snapshot} (${result.category_snapshot})`
            : "Unexpected result",
        severity: nextStatus,
        notes: draftNotes,
      })
  );

  mount(
    <InspectionChecklist
      inspection={inspectionDetail()}
      canEdit
      canForceComplete={false}
      canRecommend
      completeReturnTo={null}
    />
  );

  const noteField = document.querySelector(
    ".inspection-notes-input"
  ) as HTMLTextAreaElement;
  expect(noteField).toBeInstanceOf(HTMLTextAreaElement);

  act(() => {
    setTextareaValue(noteField, draftNotes);
  });

  if (nextStatus !== result.status) {
    await act(async () => {
      (
        [...document.querySelectorAll("button")].find(
          (button) => button.getAttribute("aria-label") === "May need future attention"
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
  }

  const hrefBefore = window.location.href;
  act(() => {
    (
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Review recommendation"
      ) as HTMLButtonElement
    ).click();
  });
  await flushAsyncWork();

  return { hrefBefore, noteField, draftNotes, nextStatus };
}

describe("InspectionRecommendationModal", () => {
  it("prefills the selected finding and closes only after a successful save", async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const action = vi.fn(async () => ({ error: null, saved: true }));
    const loadDraft = vi.fn(async () => loadedRecommendationDraft());

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={loadDraft}
        action={action}
        onClose={onClose}
        onSaved={onSaved}
      />
    );

    await flushAsyncWork();
    expect(currentDialog()).not.toBeNull();
    expect(
      (document.querySelector('[name="description"]') as HTMLInputElement).value
    ).toBe("Front brake lining (Brakes & Tires)");
    expect((document.querySelector('[name="severity"]') as HTMLSelectElement).value).toBe(
      "immediate_attention"
    );
    expect((document.querySelector('[name="notes"]') as HTMLTextAreaElement).value).toBe(
      "Pads nearly worn"
    );

    await act(async () => {
      (document.querySelector("form") as HTMLFormElement).requestSubmit();
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(loadDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open when save returns an error", async () => {
    const action = vi.fn(async () => ({
      error: "Could not save recommendation.",
      saved: false,
    }));

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={vi.fn(async () => loadedRecommendationDraft())}
        action={action}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();
    await act(async () => {
      (document.querySelector("form") as HTMLFormElement).requestSubmit();
    });

    expect(currentDialog()).not.toBeNull();
    expect(document.body.textContent).toContain("Could not save recommendation.");
  });

  it("keeps the dialog open and shows a mapped draft-load error result", async () => {
    const recovery =
      "The automatic recommendation is missing or withdrawn. Re-flag this inspection item and try again.";

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={vi.fn(async () => ({ draft: null, error: recovery }))}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();

    expect(currentDialog()).not.toBeNull();
    expect(document.body.textContent).toContain(recovery);
    expect(currentDialog()?.querySelector("form")).toBeNull();
  });

  it("does not rely on a production-redacted thrown message for draft guidance", async () => {
    const redacted =
      "An error occurred in the Server Components render. The specific message is omitted in production builds.";

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={vi.fn(async () => {
          throw new Error(redacted);
        })}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();

    expect(currentDialog()).not.toBeNull();
    expect(document.body.textContent).toContain(
      "Could not load this recommendation. Close and try again."
    );
    expect(document.body.textContent).not.toContain(redacted);
  });

  it("disables the modal form controls while a save is pending", async () => {
    let resolveAction:
      ((value: { error: string | null; saved: boolean }) => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<{ error: string | null; saved: boolean }>((resolve) => {
          resolveAction = resolve;
        })
    );

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={vi.fn(async () => loadedRecommendationDraft())}
        action={action}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();
    act(() => {
      (document.querySelector("form") as HTMLFormElement).requestSubmit();
    });
    await flushAsyncWork();

    expect(
      (currentDialog()?.querySelector("fieldset") as HTMLFieldSetElement).disabled
    ).toBe(true);

    await act(async () => {
      resolveAction?.({ error: null, saved: true });
      await Promise.resolve();
    });
  });

  it("keeps Tab on the dialog while every form control is fieldset-disabled", async () => {
    let resolveAction:
      ((value: { error: string | null; saved: boolean }) => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<{ error: string | null; saved: boolean }>((resolve) => {
          resolveAction = resolve;
        })
    );

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={vi.fn(async () => loadedRecommendationDraft())}
        action={action}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();
    act(() => {
      (document.querySelector("form") as HTMLFormElement).requestSubmit();
    });
    await flushAsyncWork();

    const dialog = currentDialog()!;
    const fieldsetControls = [
      ...dialog.querySelectorAll<HTMLElement>(
        "fieldset button, fieldset input, fieldset select, fieldset textarea"
      ),
    ];
    expect(fieldsetControls.length).toBeGreaterThan(0);
    expect(fieldsetControls.every((control) => control.matches(":disabled"))).toBe(true);

    dialog.focus();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(tab);
    });

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);

    await act(async () => {
      resolveAction?.({ error: null, saved: true });
      await Promise.resolve();
    });
  });

  it("restores focus and body scroll state when closed", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open recommendation";
    document.body.appendChild(opener);
    opener.focus();
    document.body.style.overflow = "auto";

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={vi.fn(async () => loadedRecommendationDraft())}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(currentDialog());

    act(() => {
      root?.unmount();
    });

    expect(document.body.style.overflow).toBe("auto");
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape and backdrop press while idle", async () => {
    const onClose = vi.fn();

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={vi.fn(async () => loadedRecommendationDraft())}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();
    pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = currentDialog()?.parentElement;
    expect(backdrop).not.toBeNull();

    act(() => {
      backdrop!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps keyboard focus trapped inside the dialog", async () => {
    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={vi.fn(async () => loadedRecommendationDraft())}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();
    const closeButton = document.querySelector('[aria-label="Close recommendation"]');
    const saveButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save recommendation"
    );
    expect(closeButton).toBeInstanceOf(HTMLElement);
    expect(saveButton).toBeInstanceOf(HTMLElement);

    (saveButton as HTMLElement).focus();
    pressKey("Tab");
    expect(document.activeElement).toBe(closeButton);

    (closeButton as HTMLElement).focus();
    pressKey("Tab", true);
    expect(document.activeElement).toBe(saveButton);
  });

  it("loads the latest linked recommendation values on each open", async () => {
    const loadDraft = vi
      .fn()
      .mockResolvedValueOnce(
        loadedRecommendationDraft({
          description: "Existing pending recommendation",
          severity: "safety_critical",
          notes: "Linked recommendation notes",
        })
      )
      .mockResolvedValueOnce(
        loadedRecommendationDraft({
          description: "Edited elsewhere after the first open",
          severity: "future_attention",
          notes: "Newest linked notes",
        })
      );

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={loadDraft}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();
    expect(
      (document.querySelector('[name="description"]') as HTMLInputElement).value
    ).toBe("Existing pending recommendation");
    expect((document.querySelector('[name="severity"]') as HTMLSelectElement).value).toBe(
      "safety_critical"
    );
    expect((document.querySelector('[name="notes"]') as HTMLTextAreaElement).value).toBe(
      "Linked recommendation notes"
    );

    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;

    mount(
      <InspectionRecommendationModal
        result={result}
        loadDraft={loadDraft}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await flushAsyncWork();
    expect(
      (document.querySelector('[name="description"]') as HTMLInputElement).value
    ).toBe("Edited elsewhere after the first open");
    expect((document.querySelector('[name="severity"]') as HTMLSelectElement).value).toBe(
      "future_attention"
    );
    expect((document.querySelector('[name="notes"]') as HTMLTextAreaElement).value).toBe(
      "Newest linked notes"
    );
  });

  it("opens and saves in place with the row's current local draft values", async () => {
    const { hrefBefore, noteField, draftNotes } = await openChecklistRecommendation({
      nextStatus: "future_attention",
      draftNotes: "Fresh local draft before modal open",
    });

    expect(window.location.href).toBe(hrefBefore);
    expect(currentDialog()).not.toBeNull();
    expect(actionMocks.getInspectionRecommendationDraftAction).toHaveBeenCalledWith(
      "work-order-1",
      result.inspection_result_id
    );
    expect((document.querySelector('[name="severity"]') as HTMLSelectElement).value).toBe(
      "future_attention"
    );
    expect((document.querySelector('[name="notes"]') as HTMLTextAreaElement).value).toBe(
      "Fresh local draft before modal open"
    );

    await act(async () => {
      (currentDialog()?.querySelector("form") as HTMLFormElement).requestSubmit();
    });

    expect(actionMocks.saveInspectionRecommendationAction).toHaveBeenCalledTimes(1);
    expect(currentDialog()).toBeNull();
    expect(window.location.href).toBe(hrefBefore);
    expect(noteField.value).toBe(draftNotes);
    expect(document.body.textContent).toContain("Recommendation saved");
    expect(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Edit recommendation"
      )
    ).toBeInstanceOf(HTMLButtonElement);
  });

  it("keeps a dirty modal draft when the parent checklist rerenders", async () => {
    await openChecklistRecommendation({
      nextStatus: "future_attention",
      draftNotes: "Initial linked recommendation note",
    });

    const modalNotes = currentDialog()?.querySelector(
      '[name="notes"]'
    ) as HTMLTextAreaElement;
    act(() => {
      setTextareaValue(modalNotes, "Unsaved modal edit");
    });
    actionMocks.getInspectionRecommendationDraftAction.mockResolvedValue(
      loadedRecommendationDraft({ notes: "Reloaded server value" })
    );

    act(() => {
      root!.render(
        <InspectionChecklist
          inspection={inspectionDetail()}
          canEdit
          canForceComplete={false}
          canRecommend
          completeReturnTo={null}
        />
      );
    });
    await flushAsyncWork();

    expect(actionMocks.getInspectionRecommendationDraftAction).toHaveBeenCalledTimes(1);
    expect(
      (currentDialog()?.querySelector('[name="notes"]') as HTMLTextAreaElement).value
    ).toBe("Unsaved modal edit");
  });
});
