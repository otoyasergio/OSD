// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, push, removeChannel } = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/technician",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/database/supabase-browser", () => ({
  createClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return { channel: () => channel, removeChannel };
  },
}));
vi.mock("@/app/(app)/technician/floor-actions", () => ({
  acknowledgeDocketJobAction: vi.fn(async () => null),
  completeJobFloorAction: vi.fn(async () => null),
  completePerformWorkAction: vi.fn(async () => null),
  failPeerQcAction: vi.fn(async () => null),
  installPartFloorAction: vi.fn(async () => null),
  parkJobAction: vi.fn(async () => null),
  passPeerQcAction: vi.fn(async () => null),
  pullOntoBenchAction: vi.fn(async () => null),
  resumeParkedJobAction: vi.fn(async () => null),
  skipProofAction: vi.fn(async () => null),
  swapBenchJobAction: vi.fn(async () => null),
  toggleChecklistAction: vi.fn(async () => null),
  uploadJobProofAction: vi.fn(async () => null),
}));
vi.mock("@/app/(app)/work_orders/safety-actions", () => ({
  failSafetyCheckAction: vi.fn(async () => null),
  passSafetyCheckAction: vi.fn(async () => null),
}));

import { TechnicianFloorShell } from "@/components/technician/TechnicianFloorShell";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import { completeJobFloorAction } from "@/app/(app)/technician/floor-actions";
import type { FloorOsSurface } from "@/lib/services/technicianFloor";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";

const WO = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const COLTON = "61111111-1111-4111-8111-111111111111";
const STEFANO = "71111111-1111-4111-8111-111111111111";

function surface(candidates: FloorOsSurface["peer_qc_candidates"]): FloorOsSurface {
  return {
    mode: "job",
    job_id: JOB,
    work_order_id: WO,
    work_order_number: "WO-100",
    service_name: "Oil change",
    motorcycle_label: "2020 Honda CB500F",
    customer_label: "",
    job_status: "in_progress",
    job_status_label: "In Progress",
    wo_status: "in_progress",
    wo_status_label: "In Progress",
    inspection_complete: true,
    inspection_href: "/inspect",
    overview_href: "/notes",
    started_at: "2026-10-02T16:00:00.000Z",
    completed_at: null,
    estimated_labour: 1,
    labour_label: null,
    labour_over: false,
    jobs: [
      {
        job_id: JOB,
        service_name: "Oil change",
        status: "in_progress",
        status_label: "In Progress",
        assigned_to_me: true,
        is_selected: true,
      },
    ],
    checklist: [],
    parts: [],
    proof_count: 1,
    has_proof_exception: false,
    complete_gate_ok: true,
    complete_gate_reason: null,
    can_start: false,
    can_complete: true,
    can_pull: false,
    job_timer_running: true,
    is_qc: false,
    qc_assignee_is_me: false,
    is_safety: false,
    can_safety: false,
    flags: [],
    board_status: "bench",
    board_stamp: "NOW",
    floor_acknowledged_at: "2026-10-02T16:00:00.000Z",
    floor_parked_at: null,
    floor_park_reason: null,
    floor_wait_owner: null,
    wait_owner_label: "",
    park_reason_label: "",
    steps: [
      {
        id: "complete",
        kind: "complete",
        label: "Complete job",
        state: "open",
      },
    ],
    go: {
      action: "complete",
      label: "Complete job ✓✓",
      sub: "Pick who checks your work — your clock stops.",
      enabled: true,
    },
    timer_secs: 0,
    work_brief: null,
    pending_recommendations: [],
    peer_qc_candidates: candidates,
    checkout_evidence_required: false,
    checkout_photos: [],
    jobs_complete: false,
    qc_complete: false,
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(text)
  );
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

describe("peer QC person picker", () => {
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

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderFloor(candidates: FloorOsSurface["peer_qc_candidates"]) {
    await act(async () => {
      root.render(
        React.createElement(
          PhotoUploadQueueProvider,
          {
            userId: "11111111-1111-4111-8111-111111111111",
            locationId: "location-a",
            store: new MemoryPhotoUploadQueueStore(
              createMemoryPhotoUploadQueueDatabase()
            ),
            isOnline: () => false,
          },
          React.createElement(TechnicianFloorShell, {
            floor: {
              priority: [],
              readyToPull: [],
              needsQc: [],
              safeties: [],
              flagged: [],
              selected: surface(candidates),
            },
            docketItems: [],
            readyForPickup: [],
          })
        )
      );
    });
  }

  it("lets a tech find and choose a person who is not clocked in", async () => {
    await renderFloor([
      {
        user_id: STEFANO,
        display_name: "Stefano Franco",
        clocked_in: false,
      },
      {
        user_id: COLTON,
        display_name: "Colton McDonald",
        clocked_in: true,
      },
    ]);

    await act(async () => {
      buttonByText(container, "Complete job").click();
    });

    expect(container.textContent).toContain("Who should check your work?");
    expect(container.textContent).toContain("Colton McDonald");
    expect(container.textContent).toContain("Stefano Franco");
    expect(container.textContent).toContain("On the clock");

    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "stef");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Stefano Franco");
    expect(container.textContent).not.toContain("Colton McDonald");

    await act(async () => {
      buttonByText(container, "Stefano Franco").click();
    });

    const formData = vi.mocked(completeJobFloorAction).mock.calls[0]?.[1] as FormData;
    expect(formData.get("qc_assignee_id")).toBe(STEFANO);
    expect(formData.get("job_id")).toBe(JOB);
    expect(formData.get("work_order_id")).toBe(WO);
  });

  it("explains when nobody else can review the bike", async () => {
    await renderFloor([]);
    await act(async () => {
      buttonByText(container, "Complete job").click();
    });
    expect(container.textContent).toContain("Everyone else already worked this bike");
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(buttonByText(container, "Complete without picker").disabled).toBe(false);
  });
});
