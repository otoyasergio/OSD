/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKOUT_PHOTO_CATEGORIES } from "@/lib/status/checkoutEvidence";
import { loadCommittedCheckoutPhotos } from "@/lib/services/checkoutEvidence";
import type { FloorOsSurface } from "@/lib/services/technicianFloor";
import { TechnicianFloorShell } from "@/components/technician/TechnicianFloorShell";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import { canViewerAccessWorkOrder } from "@/lib/workOrders/assignmentVisibility";

const { refresh } = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/technician",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/database/supabase-browser", () => ({
  createClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return { channel: () => channel, removeChannel: vi.fn() };
  },
}));
vi.mock("@/app/(app)/technician/floor-actions", () => ({
  acknowledgeDocketJobAction: vi.fn(),
  completeJobFloorAction: vi.fn(),
  completePerformWorkAction: vi.fn(),
  failPeerQcAction: vi.fn(),
  installPartFloorAction: vi.fn(),
  parkJobAction: vi.fn(),
  passPeerQcAction: vi.fn(),
  pullOntoBenchAction: vi.fn(),
  resumeParkedJobAction: vi.fn(),
  skipProofAction: vi.fn(),
  swapBenchJobAction: vi.fn(),
  toggleChecklistAction: vi.fn(),
  uploadJobProofAction: vi.fn(),
}));
vi.mock("@/app/(app)/work_orders/safety-actions", () => ({
  failSafetyCheckAction: vi.fn(),
  passSafetyCheckAction: vi.fn(),
}));
vi.mock("@/app/(app)/work_orders/assistant-actions", () => ({
  createAssistantThreadAction: vi.fn(),
  promoteAssistantNoteAction: vi.fn(),
  retryAssistantTurnAction: vi.fn(),
  submitAssistantTurnAction: vi.fn(),
  uploadAssistantPhotoAction: vi.fn(),
}));
vi.mock("@/app/(app)/work_orders/note-actions", () => ({
  addTechnicianNoteAction: vi.fn(),
}));

const WO = "41111111-1111-4111-8111-111111111111";

function safetySurface(overrides: Partial<FloorOsSurface> = {}): FloorOsSurface {
  return {
    mode: "safety",
    job_id: null,
    work_order_id: WO,
    work_order_number: "WO-100",
    service_name: null,
    motorcycle_label: "Yamaha R3",
    customer_label: "",
    job_status: null,
    job_status_label: null,
    wo_status: "safety_check",
    wo_status_label: "Safety check",
    inspection_complete: true,
    inspection_href: "/x",
    overview_href: "/y",
    started_at: null,
    completed_at: null,
    estimated_labour: null,
    labour_label: null,
    labour_over: false,
    jobs: [],
    checklist: [],
    parts: [],
    proof_count: 0,
    has_proof_exception: false,
    complete_gate_ok: false,
    complete_gate_reason: null,
    can_start: false,
    can_complete: false,
    can_pull: false,
    job_timer_running: false,
    is_qc: false,
    qc_assignee_is_me: false,
    is_safety: true,
    can_safety: true,
    flags: [],
    board_status: "safety",
    board_stamp: "CHECK",
    floor_acknowledged_at: null,
    floor_parked_at: null,
    floor_park_reason: null,
    floor_wait_owner: null,
    wait_owner_label: "",
    park_reason_label: "",
    steps: [],
    go: { action: "none", label: "Nothing to do", sub: "", enabled: false },
    timer_secs: 0,
    work_brief: null,
    pending_recommendations: [],
    peer_qc_candidates: [],
    checkout_evidence_required: true,
    jobs_complete: true,
    qc_complete: true,
    checkout_photos: [
      {
        photo_id: "p-front",
        category: "checkout_front",
        signed_url: "https://signed.example/front.jpg",
        thumb_url: "https://signed.example/front-thumb.jpg",
      },
    ],
    ...overrides,
  };
}

describe("loadCommittedCheckoutPhotos", () => {
  it("queries the five checkout categories and signs committed rows", async () => {
    const filters: Array<{ method: string; args: unknown[] }> = [];
    const createSignedUrls = vi.fn(async () => ({
      data: [{ path: "wo/front.jpg", signedUrl: "https://signed.example/front.jpg" }],
      error: null,
    }));
    const client = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: (...args: unknown[]) => {
            filters.push({ method: "eq", args });
            return chain;
          },
          in: (...args: unknown[]) => {
            filters.push({ method: "in", args });
            return chain;
          },
          then: (onFulfilled: (value: { data: unknown; error: null }) => unknown) =>
            Promise.resolve({
              data: [
                {
                  photo_id: "p-front",
                  category: "checkout_front",
                  storage_path: "wo/front.jpg",
                  thumb_storage_path: null,
                  photo_url: null,
                },
              ],
              error: null,
            }).then(onFulfilled),
        };
        return chain;
      },
      storage: {
        from: () => ({ createSignedUrls }),
      },
    };
    const photos = await loadCommittedCheckoutPhotos(client as never, WO);
    expect(filters.find((filter) => filter.method === "in")?.args[1]).toEqual([
      ...CHECKOUT_PHOTO_CATEGORIES,
    ]);
    expect(createSignedUrls).toHaveBeenCalled();
    expect(photos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          photo_id: "p-front",
          category: "checkout_front",
          signed_url: "https://signed.example/front.jpg",
        }),
      ])
    );
  });
});

describe("floor OS checkout surface wiring", () => {
  it("loads required flag and committed checkout photos on both floor surfaces", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "services", "technicianFloor.ts"),
      "utf8"
    );
    expect(source).toMatch(/checkout_evidence_required/);
    expect(source).toMatch(/loadCommittedCheckoutPhotos|checkout_photos/);
    expect(source).toMatch(/canViewerAccessWorkOrder/);
    expect(
      source.match(/loadCommittedCheckoutPhotos/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(2);
  });

  it("populates explicit jobs_complete and qc_complete from server data on both surfaces", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "services", "technicianFloor.ts"),
      "utf8"
    );
    expect(source).toMatch(/quality_checked_at/);
    expect(source).toMatch(/quality_checked_by_user_id/);
    expect(source).toMatch(/checkoutCapturePreconditions/);
    expect(source.match(/jobs_complete:/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source.match(/qc_complete:/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("wires the floor checkout panel from surface fields instead of hardcoded true", () => {
    const source = readFileSync(
      join(process.cwd(), "components", "technician", "TechnicianFloorShell.tsx"),
      "utf8"
    );
    expect(source).toMatch(/jobsComplete=\{surface\.jobs_complete\}/);
    expect(source).toMatch(/qcComplete=\{surface\.qc_complete\}/);
    expect(source).not.toMatch(/^\s+jobsComplete\s*$/m);
    expect(source).not.toMatch(/^\s+qcComplete\s*$/m);
  });

  it("keeps ordinary technicians off unrelated work orders", () => {
    expect(
      canViewerAccessWorkOrder(
        {
          primary_technician_id: "someone-else",
          quality_check_assigned_to: null,
          status: "safety_check",
          jobs: [{ assigned_technician_id: "someone-else" }],
        },
        "technician",
        "tech-1"
      )
    ).toBe(false);
    expect(
      canViewerAccessWorkOrder(
        {
          primary_technician_id: "someone-else",
          quality_check_assigned_to: null,
          status: "safety_check",
          jobs: [{ assigned_technician_id: "someone-else" }],
        },
        "head_tech",
        "tech-1"
      )
    ).toBe(true);
  });
});

describe("final-inspection checkout capture", () => {
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

  it("renders checkout slots for can_safety without override controls", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "head-tech",
            locationId: "location-a",
            store,
            isOnline: () => true,
          },
          createElement(TechnicianFloorShell, {
            floor: {
              priority: [],
              readyToPull: [],
              needsQc: [],
              safeties: [],
              flagged: [],
              selected: safetySurface(),
            },
            stage: "done",
            viewerUserId: "head-tech",
            docketItems: [],
            readyForPickup: [],
          })
        )
      );
    });
    expect(container.textContent).toMatch(/Checkout evidence/i);
    expect(container.textContent).toMatch(/4 checkout photos? missing/i);
    expect(container.querySelectorAll(".inspection-photo-slot").length).toBe(5);
    expect(container.textContent).not.toMatch(/Record emergency override/i);
    expect(container.textContent).toMatch(/Pass final inspection/i);
  });

  it("does not render checkout capture for ordinary technicians without can_safety", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "tech-1",
            locationId: "location-a",
            store,
            isOnline: () => true,
          },
          createElement(TechnicianFloorShell, {
            floor: {
              priority: [],
              readyToPull: [],
              needsQc: [],
              safeties: [],
              flagged: [],
              selected: safetySurface({ can_safety: false }),
            },
            stage: "done",
            viewerUserId: "tech-1",
            docketItems: [],
            readyForPickup: [],
          })
        )
      );
    });
    expect(container.querySelectorAll(".inspection-photo-slot")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Record emergency override/i);
  });

  it("disables floor checkout capture unless surface jobs and QC flags are true", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "head-tech",
            locationId: "location-a",
            store,
            isOnline: () => true,
          },
          createElement(TechnicianFloorShell, {
            floor: {
              priority: [],
              readyToPull: [],
              needsQc: [],
              safeties: [],
              flagged: [],
              selected: safetySurface({ jobs_complete: false, qc_complete: false }),
            },
            stage: "done",
            viewerUserId: "head-tech",
            docketItems: [],
            readyForPickup: [],
          })
        )
      );
    });
    expect(container.querySelectorAll(".inspection-photo-slot").length).toBe(5);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).toMatch(/after jobs and quality check/i);

    await act(async () => {
      root.render(
        createElement(
          PhotoUploadQueueProvider,
          {
            userId: "head-tech",
            locationId: "location-a",
            store,
            isOnline: () => true,
          },
          createElement(TechnicianFloorShell, {
            floor: {
              priority: [],
              readyToPull: [],
              needsQc: [],
              safeties: [],
              flagged: [],
              selected: safetySurface({ jobs_complete: true, qc_complete: true }),
            },
            stage: "done",
            viewerUserId: "head-tech",
            docketItems: [],
            readyForPickup: [],
          })
        )
      );
    });
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
  });
});
