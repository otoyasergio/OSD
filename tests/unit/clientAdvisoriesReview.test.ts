/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecommendationsSummary } from "@/components/recommendations/RecommendationsSummary";
import type { Recommendation } from "@/lib/services/recommendations";
import type { AdvisoryReviewPhoto } from "@/lib/recommendations/advisoryReview";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

function recommendation(
  overrides: Partial<Recommendation> &
    Pick<Recommendation, "recommendation_id" | "description">
): Recommendation {
  return {
    work_order_id: "wo-1",
    inspection_result_id: null,
    created_by_user_id: null,
    severity: "future_attention",
    status: "pending",
    converted_job_id: null,
    notes: null,
    created_at: "2026-10-01T12:00:00.000Z",
    resolved_at: null,
    ...overrides,
  };
}

const immediate = recommendation({
  recommendation_id: "rec-immediate",
  description: "Front brake pads worn",
  severity: "immediate_attention",
  status: "pending",
  inspection_result_id: "result-immediate",
  notes: "Metal on metal",
});

const future = recommendation({
  recommendation_id: "rec-future",
  description: "Chain slack",
  severity: "future_attention",
  status: "pending",
  inspection_result_id: "result-future",
});

const photos: AdvisoryReviewPhoto[] = [
  {
    photo_id: "photo-front",
    category: "front",
    notes: "Intake front",
    inspection_result_id: null,
    thumb_url: "https://signed.example/front.jpg",
    signed_url: "https://signed.example/front-full.jpg",
    photo_url: null,
  },
  {
    photo_id: "photo-pads",
    category: "inspection_item",
    notes: "Pad photo",
    inspection_result_id: "result-immediate",
    thumb_url: "https://signed.example/pads.jpg",
    signed_url: null,
    photo_url: null,
  },
];

describe("Client advisories opens photos and advisories", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
    document.body.innerHTML = "";
  });

  async function renderSummary() {
    await act(async () => {
      root.render(
        createElement(RecommendationsSummary, {
          recommendations: [immediate, future],
          estimateLines: [],
          canSendEstimate: false,
          sendEstimateAction: async () => ({ error: null }),
          photos,
        })
      );
    });
  }

  function reviewDialog() {
    return document.querySelector('[aria-label="Photos and advisories"]');
  }

  it("opens photos and every advisory when Client advisories is clicked", async () => {
    await renderSummary();
    expect(reviewDialog()).toBeNull();

    const open = container.querySelector(
      'button[aria-label="Client advisories — open photos and advisories"]'
    ) as HTMLButtonElement;
    expect(open).toBeTruthy();
    expect(open.textContent).toMatch(/Client advisories/);
    expect(open.getAttribute("aria-label")).toMatch(/Client advisories/);

    await act(async () => {
      open.click();
    });

    const dialog = reviewDialog();
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toMatch(/Photos/);
    expect(dialog?.textContent).toMatch(/Advisories/);
    expect(dialog?.textContent).toMatch(/Front brake pads worn/);
    expect(dialog?.textContent).toMatch(/Chain slack/);
    expect(dialog?.textContent).toMatch(/Metal on metal/);
    expect(dialog?.querySelector('img[alt="Front"]')).toBeTruthy();
    expect(dialog?.querySelector('img[alt="Inspection — Needs work"]')).toBeTruthy();
    expect(dialog?.textContent).toMatch(/Pad photo/);
  });

  it("keeps keyboard focus inside the advisory dialog", async () => {
    await renderSummary();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Client advisories — open photos and advisories"]'
        )!
        .click();
    });

    const dialog = reviewDialog() as HTMLElement;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(first);

    first.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(document.activeElement).toBe(last);
  });

  it("makes the advisory dialog inert while its photo viewer is open", async () => {
    await renderSummary();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Client advisories — open photos and advisories"]'
        )!
        .click();
    });

    const advisoryDialog = reviewDialog() as HTMLElement;
    await act(async () => {
      advisoryDialog
        .querySelector<HTMLButtonElement>('button[aria-label="Open Front photo"]')!
        .click();
    });

    const modalDialogs = document.querySelectorAll(
      '[role="dialog"][aria-modal="true"]'
    );
    expect(modalDialogs).toHaveLength(1);
    expect(modalDialogs[0]?.getAttribute("aria-label")).toMatch(/Photo viewer/);
    expect(advisoryDialog.getAttribute("aria-hidden")).toBe("true");
    expect(advisoryDialog.parentElement?.hasAttribute("inert")).toBe(true);
  });

  it("loads dialog thumbnails lazily", async () => {
    await renderSummary();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Client advisories — open photos and advisories"]'
        )!
        .click();
    });

    const images = reviewDialog()?.querySelectorAll("img") ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.getAttribute("loading")).toBe("lazy");
      expect(image.getAttribute("decoding")).toBe("async");
    }
  });

  it("opens the clicked count with that advisory group and the photos", async () => {
    await renderSummary();
    const immediateTile = container.querySelector(
      'button[aria-label="Open photos and advisories — Immediate Attention, 1"]'
    ) as HTMLButtonElement;
    expect(immediateTile).toBeTruthy();

    await act(async () => {
      immediateTile.click();
    });

    const dialog = reviewDialog();
    expect(dialog?.textContent).toMatch(/Front brake pads worn/);
    expect(dialog?.textContent).not.toMatch(/Chain slack/);
    expect(dialog?.querySelector('img[alt="Front"]')).toBeTruthy();
    expect(dialog?.querySelector('img[alt="Inspection — Needs work"]')).toBeTruthy();
  });

  it("closes the photos and advisories view", async () => {
    await renderSummary();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Client advisories — open photos and advisories"]'
        )!
        .click();
    });
    expect(reviewDialog()).toBeTruthy();

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close photos and advisories"]'
        )!
        .click();
    });
    expect(reviewDialog()).toBeNull();
    expect(container.textContent).toMatch(/Client advisories/);
  });
});
