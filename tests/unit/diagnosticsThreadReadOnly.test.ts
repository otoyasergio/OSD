// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, retryAssistantTurnAction } = vi.hoisted(() => ({
  refresh: vi.fn(),
  retryAssistantTurnAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/app/(app)/work_orders/assistant-actions", () => ({
  retryAssistantTurnAction,
}));
vi.mock("@/app/(app)/work_orders/note-actions", () => ({
  addTechnicianNoteAction: vi.fn(),
}));

import { DiagnosticsThreadReadOnly } from "@/components/diagnostics/DiagnosticsThreadReadOnly";
import { JobPacketPanel } from "@/components/technician/JobPacketPanel";
import type { DiagnosticsThreadWorkspace } from "@/lib/services/diagnosticsAssistant";

const WORK_ORDER = "41111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";

function workspace(
  overrides: Partial<DiagnosticsThreadWorkspace["thread"]> = {}
): DiagnosticsThreadWorkspace {
  return {
    thread: {
      threadId: THREAD,
      workOrderId: WORK_ORDER,
      jobId: null,
      locationId: "31111111-1111-4111-8111-111111111111",
      mode: "shop",
      audience: "technical",
      status: "ready",
      diagnosticPhase: "diagnosis",
      triggerType: "inspection_completed",
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
      ...overrides,
    },
    messages: [
      {
        messageId: "a1111111-1111-4111-8111-111111111111",
        threadId: THREAD,
        role: "assistant",
        body: "Inspect the battery terminals next.",
        generationStatus: "ready",
        requestedInput: null,
        phase: "diagnosis",
        safeErrorCode: null,
        parentUserMessageId: "b1111111-1111-4111-8111-111111111111",
        requestedProviderModel: "model",
        providerModel: "model",
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
        photos: [],
      },
    ],
  };
}

describe("DiagnosticsThreadReadOnly", () => {
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

  it("shows the selected automatic thread, status, messages, and review label", async () => {
    await act(async () => {
      root.render(
        React.createElement(DiagnosticsThreadReadOnly, {
          workspace: workspace(),
        })
      );
    });

    expect(container.textContent).toContain("Ask OTOMOTO");
    expect(container.textContent).toContain("Shop");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Automatic arrival-inspection review");
    expect(container.textContent).toContain("Staff review required");
    expect(container.textContent).toContain("Inspect the battery terminals next.");
  });

  it("shows refresh while pending and Retry only for failed threads", async () => {
    await act(async () => {
      root.render(
        React.createElement(DiagnosticsThreadReadOnly, {
          workspace: workspace({ status: "generating" }),
        })
      );
    });
    expect(container.textContent).toContain("Generating");
    expect(container.querySelector('button[type="button"]')?.textContent).toMatch(
      /refresh/i
    );
    expect(container.querySelector('button[type="submit"]')).toBeNull();

    await act(async () => {
      root.render(
        React.createElement(DiagnosticsThreadReadOnly, {
          workspace: workspace({ status: "failed" }),
        })
      );
    });
    expect(container.textContent).toContain("Failed");
    expect(container.querySelector('button[type="submit"]')?.textContent).toMatch(
      /retry/i
    );
  });

  it("renders the exact selected workspace in the floor assistant packet", async () => {
    await act(async () => {
      root.render(
        React.createElement(JobPacketPanel, {
          packet: {
            work_order_id: WORK_ORDER,
            work_order_number: "WO-100",
            wo_status: "in_progress",
            wo_status_label: "In progress",
            motorcycle_label: "2026 Honda CB500F",
            jobs: [],
            pending_recommendations: [],
            notes: [],
          },
          section: "assistant",
          closeHref: `/technician?wo=${WORK_ORDER}`,
          stage: "work",
          assistantWorkspace: workspace(),
        })
      );
    });

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    ).toContain("Ask OTOMOTO");
    expect(container.textContent).toContain("Inspect the battery terminals next.");
  });
});
