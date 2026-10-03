/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CheckoutEvidencePanel } from "@/components/photos/CheckoutEvidencePanel";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import { OverviewTab } from "@/components/work_orders/OverviewTab";
import { CHECKOUT_PHOTO_CATEGORIES } from "@/lib/status/checkoutEvidence";
import type { WorkOrderDetail } from "@/lib/services/workOrders";
import type { IntakePhoto } from "@/lib/services/photos";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

function photoFile(name = "shot.jpg"): File {
  return new File(["jpeg-bytes"], name, { type: "image/jpeg", lastModified: 1_700 });
}

function detail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    work_order_id: "wo-1",
    motorcycle_id: "mc-1",
    customer_id: "cust-1",
    location_id: "loc-1",
    work_order_number: "WO-100",
    external_invoice_number: null,
    status: "quality_check",
    primary_technician_id: null,
    created_by_user_id: null,
    date_created: "2026-10-01T10:00:00.000Z",
    estimated_completion: null,
    mileage: 1000,
    mileage_unit: "km",
    internal_notes: null,
    quality_checked_by_user_id: "user-1",
    quality_checked_at: "2026-10-01T12:00:00.000Z",
    quality_check_notes: null,
    quality_check_assigned_to: null,
    safety_checked_by_user_id: null,
    safety_checked_at: null,
    safety_check_notes: null,
    safety_required: false,
    safety_waived: true,
    ready_for_pickup_at: null,
    completed_at: null,
    released_by_user_id: null,
    pickup_notes: null,
    checkout_evidence_required: true,
    checkout_evidence_override_at: null,
    checkout_evidence_override_by_user_id: null,
    checkout_evidence_override_reason: null,
    square_invoice_id: null,
    square_payment_status: null,
    square_invoice_public_url: null,
    billing_stage: "none",
    billing_amount_mode: null,
    billing_amount_cents: null,
    billing_collected_cents: 0,
    estimate_sent_at: null,
    invoice_published_at: null,
    wix_booking_id: null,
    scheduled_at: null,
    source: "manual",
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    customer: null,
    motorcycle: null,
    primary_technician: null,
    quality_check_assignee: null,
    open_admin_flags: [],
    technicians: [],
    jobs: [
      {
        job_id: "job-1",
        service_id: "svc-1",
        service_name_snapshot: "Oil Change",
        status: "completed",
        origin: "customer_request",
        assigned_technician_id: null,
        standard_price_snapshot: 100,
        estimated_labour_snapshot: 1,
        notes: null,
        approved_by_customer_at: null,
        approval_method: null,
        declined_at: null,
        decline_reason: null,
        created_at: "2026-10-01T10:00:00.000Z",
        started_at: null,
        completed_at: "2026-10-01T11:00:00.000Z",
        assigned_technician: null,
      },
    ],
    flags: [],
    agreement_follow_up: null,
    is_foreign_location: false,
    ...overrides,
  } as WorkOrderDetail;
}

const noopAction = async () => ({ error: null });

describe("CheckoutEvidencePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:checkout") as never;
    URL.revokeObjectURL = vi.fn() as never;
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

  it("does not render a blocking panel for legacy work orders", async () => {
    await act(async () => {
      root.render(
        createElement(CheckoutEvidencePanel, {
          workOrderId: "wo-1",
          required: false,
          photos: [],
          jobsComplete: true,
          qcComplete: true,
          canUpload: true,
          locked: false,
        })
      );
    });
    expect(container.textContent).not.toMatch(/Checkout/i);
    expect(container.querySelectorAll(".inspection-photo-slot")).toHaveLength(0);
  });

  it("enqueues the exact five checkout categories and shows missing/saved state", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(CheckoutEvidencePanel, {
            workOrderId: "wo-1",
            required: true,
            photos: [
              {
                photo_id: "p-front",
                category: "checkout_front",
                signed_url: "https://signed.example/front.jpg",
                thumb_url: "https://signed.example/front-thumb.jpg",
              },
            ],
            jobsComplete: true,
            qcComplete: true,
            canUpload: true,
            locked: false,
          })
        )
      );
    });

    expect(container.textContent).toMatch(/4 checkout photos? missing/i);
    expect(container.textContent).toMatch(/1 photo/i);
    expect(container.querySelector('img[alt="Checkout — Front 1"]')).toBeTruthy();

    const input = container.querySelector(
      'input[aria-label="Checkout — Rear photo library"]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [photoFile("rear.jpg")],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(async () => {
      const items = await store.list({ userId: "user-a", locationId: "location-a" });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        category: "checkout_rear",
        workOrderId: "wo-1",
      });
    });
  });

  it("keeps inputs disabled until jobs and QC represent final condition", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => true,
          },
          createElement(CheckoutEvidencePanel, {
            workOrderId: "wo-1",
            required: true,
            photos: [],
            jobsComplete: false,
            qcComplete: false,
            canUpload: true,
            locked: false,
          })
        )
      );
    });
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toMatch(/after jobs and quality check/i);
  });
});

describe("Overview completion checkout gate", () => {
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

  function renderOverview(
    overrides: Partial<WorkOrderDetail> = {},
    photos: Array<
      Pick<IntakePhoto, "photo_id" | "category"> & { signed_url?: string }
    > = []
  ) {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    return act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => true,
          },
          createElement(OverviewTab, {
            detail: detail(overrides),
            technicians: [],
            canAssign: false,
            canRunQc: false,
            canMarkReady: true,
            canComplete: true,
            canHoldOrCancel: false,
            canResumeHold: false,
            canOverrideComplete: true,
            canOverrideCheckout: true,
            inspectionCompleted: true,
            readOnly: false,
            photos: photos as IntakePhoto[],
            canUploadPhotos: true,
            assignAction: noopAction,
            setPrimaryAction: noopAction,
            qcAction: noopAction,
            readyAction: noopAction,
            completeAction: noopAction,
            cancelAction: noopAction,
            holdAction: noopAction,
            resumeAction: noopAction,
            checkoutOverrideAction: noopAction,
          })
        )
      );
    });
  }

  it("keeps checkout capture closed unless both QC columns and jobs are complete", async () => {
    await renderOverview({
      quality_checked_at: "2026-10-01T12:00:00.000Z",
      quality_checked_by_user_id: null,
    });
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toMatch(/after jobs and quality check/i);

    await renderOverview({
      quality_checked_at: null,
      quality_checked_by_user_id: "user-1",
    });
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toMatch(/after jobs and quality check/i);

    await renderOverview();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("sets maxLength=500 on the override reason textarea", async () => {
    await renderOverview();
    const open = Array.from(container.querySelectorAll("button")).find((button) =>
      /Record emergency override/i.test(button.textContent ?? "")
    );
    expect(open).toBeTruthy();
    await act(async () => {
      open!.click();
    });
    const textarea = container.querySelector(
      'textarea[name="reason"]'
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    expect(textarea?.maxLength).toBe(500);
  });

  it("hides Mark Ready until server-confirmed checkout photos or override exist", async () => {
    await renderOverview();
    expect(container.textContent).not.toMatch(/Mark ready for pickup/i);
    expect(container.textContent).toMatch(/emergency/i);

    await renderOverview({
      checkout_evidence_override_at: "2026-10-01T12:08:00.000Z",
      checkout_evidence_override_by_user_id: "user-1",
      checkout_evidence_override_reason: "wet",
    });
    expect(container.textContent).toMatch(/Mark ready for pickup/i);
  });

  it("shows Mark Ready when all five committed checkout categories are present", async () => {
    await renderOverview(
      {},
      CHECKOUT_PHOTO_CATEGORIES.map((category, index) => ({
        photo_id: `p-${index}`,
        category,
        signed_url: `https://signed.example/${category}.jpg`,
      }))
    );
    expect(container.textContent).toMatch(/Mark ready for pickup/i);
  });

  it("does not show the checkout panel on legacy work orders", async () => {
    await renderOverview({ checkout_evidence_required: false });
    expect(container.textContent).not.toMatch(/Checkout evidence/i);
    expect(container.textContent).toMatch(/Mark ready for pickup/i);
  });

  it("hides Complete until checkout is ready, even for canOverrideComplete", async () => {
    await renderOverview();
    expect(container.textContent).not.toMatch(/Complete work order/i);
    expect(container.textContent).toMatch(/emergency/i);
    expect(container.textContent).toMatch(/checkout evidence/i);

    await renderOverview({
      checkout_evidence_override_at: "2026-10-01T12:08:00.000Z",
    });
    expect(container.textContent).not.toMatch(/Complete work order/i);
    expect(container.textContent).not.toMatch(/Mark ready for pickup/i);
  });

  it("shows Complete after committed photos or a persisted reasoned override", async () => {
    await renderOverview(
      {},
      CHECKOUT_PHOTO_CATEGORIES.map((category, index) => ({
        photo_id: `p-${index}`,
        category,
        signed_url: `https://signed.example/${category}.jpg`,
      }))
    );
    expect(container.textContent).toMatch(/Complete work order/i);

    await renderOverview({
      checkout_evidence_override_at: "2026-10-01T12:08:00.000Z",
      checkout_evidence_override_by_user_id: "user-1",
      checkout_evidence_override_reason: "wet",
    });
    expect(container.textContent).toMatch(/Complete work order/i);
  });
});

describe("checkout UI wiring", () => {
  it("reuses InspectionPhotoSlot instead of a second uploader", () => {
    const source = readFileSync(
      join(process.cwd(), "components/photos/CheckoutEvidencePanel.tsx"),
      "utf8"
    );
    expect(source).toMatch(/InspectionPhotoSlot/);
    expect(source).toMatch(/CHECKOUT_PHOTO_CATEGORIES/);
    expect(source).toMatch(/router\.refresh|InspectionPhotoSlot/);
    expect(source).not.toMatch(/uploadIntakePhotoAction/);
    expect(source).not.toMatch(/formData\.append\("file"/);
  });

  it("keeps checkout categories out of the Photos-tab upload selector but in the filter", () => {
    const source = readFileSync(
      join(process.cwd(), "components/photos/PhotosTab.tsx"),
      "utf8"
    );
    expect(source).toMatch(/GENERAL_WORK_ORDER_PHOTO_CATEGORIES/);
    expect(source).toMatch(/PHOTO_CATEGORY_LABELS/);
    expect(source).toMatch(/checkout_|CHECKOUT_PHOTO_CATEGORIES/);
  });

  it("wires already-loaded photos into Overview completion", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/work_orders/[work_order_id]/page.tsx"),
      "utf8"
    );
    expect(source).toMatch(/photos=\{photos\}/);
    expect(source).toMatch(/canUploadPhotos=\{canUploadPhotos\}/);
    expect(source).toMatch(/recordCheckoutEvidenceOverrideAction/);
    expect(source).toMatch(/checkoutCoverageFromPhotos\(photos\)/);
    expect(source).toMatch(/checkoutEvidenceOverridden/);
    expect(source).toMatch(/checkoutCoverage=\{checkoutCoverage\}/);
  });

  it("uses the strict override helper in Overview instead of a lone timestamp", () => {
    const source = readFileSync(
      join(process.cwd(), "components/work_orders/OverviewTab.tsx"),
      "utf8"
    );
    expect(source).toMatch(/checkoutEvidenceOverridden/);
    expect(source).not.toMatch(
      /checkoutOverridden\s*=\s*Boolean\(\s*detail\.checkout_evidence_override_at/
    );
  });

  it("derives Overview qcDone from both quality columns, matching the capture gate", () => {
    const source = readFileSync(
      join(process.cwd(), "components/work_orders/OverviewTab.tsx"),
      "utf8"
    );
    expect(source).toMatch(/checkoutCapturePreconditions/);
    expect(source).not.toMatch(
      /qcDone\s*=\s*Boolean\(\s*detail\.quality_checked_at\s*\|\|/
    );
  });

  it("caps the checkout override textarea at the shared 500-character limit", () => {
    const source = readFileSync(
      join(process.cwd(), "components/photos/CheckoutEvidencePanel.tsx"),
      "utf8"
    );
    expect(source).toMatch(/maxLength=\{CHECKOUT_EVIDENCE_OVERRIDE_REASON_MAX_LENGTH\}/);
    expect(source).toMatch(/TextAreaField/);
  });
});
