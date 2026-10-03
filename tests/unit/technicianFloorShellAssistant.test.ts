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

import { TechnicianFloorShell } from "@/components/technician/TechnicianFloorShell";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import type { AskOtomotoPanelData } from "@/lib/diagnostics/askOtomotoView";
import type { JobPacket } from "@/lib/services/jobPacket";

const WO = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";
const TECH = "11111111-1111-4111-8111-111111111111";

const packet: JobPacket = {
  work_order_id: WO,
  work_order_number: "WO-100",
  wo_status: "in_progress",
  wo_status_label: "In progress",
  motorcycle_label: "2026 Honda CB500F",
  is_foreign_location: false,
  jobs: [],
  pending_recommendations: [],
  notes: [],
};

function assistant(overrides: Partial<AskOtomotoPanelData> = {}): AskOtomotoPanelData {
  return {
    route: { surface: "floor", workOrderId: WO, jobId: JOB, stage: "work" },
    threads: [
      {
        threadId: THREAD,
        jobId: JOB,
        jobLabel: "Brake service",
        mode: "shop",
        audience: "technical",
        status: "ready",
        diagnosticPhase: "diagnosis",
        triggerType: null,
        createdAt: "2026-09-29T10:00:00.000Z",
        updatedAt: "2026-09-29T10:00:00.000Z",
      },
    ],
    selectedThreadId: THREAD,
    workspace: {
      thread: {
        threadId: THREAD,
        workOrderId: WO,
        jobId: JOB,
        mode: "shop",
        audience: "technical",
        status: "ready",
        diagnosticPhase: "diagnosis",
        triggerType: null,
        createdAt: "2026-09-29T10:00:00.000Z",
        updatedAt: "2026-09-29T10:00:00.000Z",
      },
      messages: [
        {
          messageId: "a1111111-1111-4111-8111-111111111111",
          role: "assistant",
          body: "**NEXT STEP:** Measure resting battery voltage.",
          generationStatus: "ready",
          requestedInput: null,
          phase: "diagnosis",
          promotedNoteId: null,
          photos: [],
        },
      ],
    },
    jobs: [{ jobId: JOB, label: "Brake service" }],
    defaultJobId: JOB,
    photos: [],
    config: { configured: true, modelLabel: "gpt-6-astra", reason: null },
    capabilities: {
      canMutate: false,
      preview: false,
      readOnly: true,
      lockReason: "foreign",
      canUseFrontOfficeModes: false,
      canPromoteNotes: false,
    },
    historyUnavailable: false,
    ...overrides,
  };
}

describe("TechnicianFloorShell Ask OTOMOTO packet wiring", () => {
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

  async function renderShell(
    props: Partial<React.ComponentProps<typeof TechnicianFloorShell>>
  ) {
    await act(async () => {
      root.render(
        React.createElement(
          PhotoUploadQueueProvider,
          {
            userId: TECH,
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
              selected: null,
            },
            stage: "work",
            viewerUserId: TECH,
            docketItems: [],
            readyForPickup: [],
            panel: "packet",
            packet,
            packetSection: "assistant",
            packetPhotos: [],
            packetWorkOrderId: WO,
            packetJobId: JOB,
            ...props,
          })
        )
      );
    });
  }

  it("passes the server-built assistant data through the packet to the shared panel", async () => {
    await renderShell({ packetAssistant: assistant() });

    const tabpanel = container.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(tabpanel.querySelector("h3")?.textContent).toBe("Ask OTOMOTO");
    expect(tabpanel.textContent).toContain("Measure resting battery voltage.");
    expect(tabpanel.textContent).toContain("Job: Brake service");

    const threadLink = tabpanel.querySelector<HTMLAnchorElement>(
      'nav[aria-label="Ask OTOMOTO conversations"] a'
    )!;
    const url = new URL(threadLink.getAttribute("href")!, "https://example.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      wo: WO,
      job: JOB,
      stage: "work",
      panel: "packet",
      packetSection: "assistant",
      assistantThread: THREAD,
    });

    const selectedTab = container.querySelector<HTMLAnchorElement>(
      '[role="tab"][aria-selected="true"]'
    )!;
    expect(new URL(selectedTab.href).searchParams.get("assistantThread")).toBe(THREAD);
  });

  it("keeps the server lock visible through the shell", async () => {
    await renderShell({ packetAssistant: assistant() });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[role="tabpanel"] textarea'
    );
    expect(textarea?.disabled).toBe(true);
    expect(container.textContent).toMatch(/another location/i);
  });

  it("shows the packet fallback when the assistant section failed to load", async () => {
    await renderShell({ packetAssistant: null });
    const tabpanel = container.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(tabpanel.textContent).toContain("Ask OTOMOTO could not load for this bike.");
    expect(tabpanel.querySelector("form")).toBeNull();
  });
});
