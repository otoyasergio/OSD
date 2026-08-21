/** @vitest-environment jsdom */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectionRecommendationModal } from "@/components/inspections/InspectionRecommendationModal";

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

describe("InspectionRecommendationModal", () => {
  it("prefills the selected finding and closes only after a successful save", async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const action = vi.fn(async () => ({ error: null, saved: true }));

    mount(
      <InspectionRecommendationModal
        result={result}
        action={action}
        onClose={onClose}
        onSaved={onSaved}
      />
    );

    expect(currentDialog()).not.toBeNull();
    expect(
      (document.querySelector('[name="description"]') as HTMLInputElement).value
    ).toContain("Front brake lining");
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
  });

  it("keeps the dialog open when save returns an error", async () => {
    const action = vi.fn(async () => ({
      error: "Could not save recommendation.",
      saved: false,
    }));

    mount(
      <InspectionRecommendationModal
        result={result}
        action={action}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await act(async () => {
      (document.querySelector("form") as HTMLFormElement).requestSubmit();
    });

    expect(currentDialog()).not.toBeNull();
    expect(document.body.textContent).toContain("Could not save recommendation.");
  });

  it("restores focus and body scroll state when closed", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open recommendation";
    document.body.appendChild(opener);
    opener.focus();
    document.body.style.overflow = "auto";

    mount(
      <InspectionRecommendationModal
        result={result}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(currentDialog());

    act(() => {
      root?.unmount();
    });

    expect(document.body.style.overflow).toBe("auto");
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape and backdrop press while idle", () => {
    const onClose = vi.fn();

    mount(
      <InspectionRecommendationModal
        result={result}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );

    pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = currentDialog()?.parentElement;
    expect(backdrop).not.toBeNull();

    act(() => {
      backdrop!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps keyboard focus trapped inside the dialog", () => {
    mount(
      <InspectionRecommendationModal
        result={result}
        action={vi.fn(async () => ({ error: null, saved: true }))}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

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
});
