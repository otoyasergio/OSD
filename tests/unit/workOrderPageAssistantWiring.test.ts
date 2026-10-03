import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WO = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const CANCELLED_JOB = "53333333-3333-4333-8333-333333333333";
const THREAD = "71111111-1111-4111-8111-111111111111";
const SUBJECT = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  getRolePreviewContext: vi.fn(),
  getWorkOrderDetail: vi.fn(),
  listIntakePhotos: vi.fn(),
  listThreads: vi.fn(),
  loadThread: vi.fn(),
}));

function stubModule(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (key === "then" || typeof key === "symbol") return undefined;
      return vi.fn(async () => []);
    },
    has: () => true,
  });
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/lib/auth/role-preview", () => ({
  getRolePreviewContext: mocks.getRolePreviewContext,
}));
vi.mock("@/lib/services/workOrders", () => ({
  getWorkOrderDetail: mocks.getWorkOrderDetail,
  listTechniciansForActiveLocation: vi.fn(async () => []),
}));
vi.mock("@/lib/services/photos", () => ({ listIntakePhotos: mocks.listIntakePhotos }));
vi.mock("@/lib/services/diagnosticsAssistant", () => ({
  createDiagnosticsAssistantService: () => ({
    listThreads: mocks.listThreads,
    loadThread: mocks.loadThread,
  }),
}));
vi.mock("@/lib/services/serviceCatalogue", () => stubModule());
vi.mock("@/lib/services/inspections", () => stubModule());
vi.mock("@/lib/services/recommendations", () =>
  stubModule({ isRecommendationOpenForEstimate: () => false })
);
vi.mock("@/lib/services/estimates", () => stubModule());
vi.mock("@/lib/services/parts", () =>
  stubModule({ listPartsForWorkOrder: async () => [] })
);
vi.mock("@/lib/services/notes", () =>
  stubModule({ listTechnicianNotes: async () => [] })
);
vi.mock("@/lib/services/timeline", () => stubModule());
vi.mock("@/lib/services/motorcycles", () => stubModule());
vi.mock("@/lib/services/communications", () => stubModule());
vi.mock("@/lib/services/contracts", () => stubModule());
for (const path of [
  "@/app/(app)/motorcycles/actions",
  "@/app/(app)/work_orders/actions",
  "@/app/(app)/work_orders/job-actions",
  "@/app/(app)/work_orders/recommendation-actions",
  "@/app/(app)/work_orders/estimate-actions",
  "@/app/(app)/work_orders/part-actions",
  "@/app/(app)/work_orders/photo-actions",
  "@/app/(app)/work_orders/note-actions",
  "@/app/(app)/work_orders/quality-actions",
  "@/app/(app)/work_orders/safety-actions",
  "@/app/(app)/work_orders/contract-actions",
]) {
  vi.doMock(path, () => stubModule());
}
vi.mock("@/components/diagnostics/AskOtomotoPanel", () => ({
  AskOtomotoPanel: function AskOtomotoPanel() {
    return null;
  },
}));

function preview(role: string, isPreviewing: boolean) {
  return {
    actor: { user_id: SUBJECT, role: isPreviewing ? "owner" : role },
    role,
    subjectUserId: SUBJECT,
    subjectLabel: null,
    isPreviewing,
  };
}

const detail = (overrides: Record<string, unknown> = {}) => ({
  work_order_id: WO,
  motorcycle_id: "81111111-1111-4111-8111-111111111111",
  status: "in_progress",
  is_foreign_location: false,
  jobs: [
    { job_id: JOB, service_name_snapshot: "Brake service", status: "in_progress" },
    { job_id: CANCELLED_JOB, service_name_snapshot: "Old job", status: "cancelled" },
  ],
  customer: { phone: "647-555-0100", email: "jane@example.com" },
  ...overrides,
});

function findPanelProps(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findPanelProps(child);
      if (found) return found;
    }
    return null;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  const route = element.props?.route as { surface?: string } | undefined;
  if (route?.surface === "office") {
    return element.props ?? null;
  }
  return findPanelProps(element.props?.children);
}

async function renderPage(
  search: Record<string, string>,
  role = "service_advisor",
  isPreviewing = false
) {
  mocks.getRolePreviewContext.mockResolvedValue(preview(role, isPreviewing));
  const { default: WorkOrderDetailPage } =
    await import("@/app/(app)/work_orders/[work_order_id]/page");
  const tree = await WorkOrderDetailPage({
    params: Promise.resolve({ work_order_id: WO }),
    searchParams: Promise.resolve(search),
  });
  return findPanelProps(tree as React.ReactNode);
}

describe("work order page Ask OTOMOTO wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "sk-test-secret");
    mocks.getWorkOrderDetail.mockResolvedValue(detail());
    mocks.listIntakePhotos.mockResolvedValue([]);
    mocks.listThreads.mockResolvedValue([
      {
        threadId: THREAD,
        workOrderId: WO,
        jobId: JOB,
        locationId: "31111111-1111-4111-8111-111111111111",
        mode: "advisor",
        audience: "front_office",
        status: "ready",
        diagnosticPhase: null,
        triggerType: null,
        createdAt: "2026-09-29T10:00:00.000Z",
        updatedAt: "2026-09-29T10:00:00.000Z",
      },
    ]);
    mocks.loadThread.mockResolvedValue({
      thread: {
        threadId: THREAD,
        workOrderId: WO,
        jobId: JOB,
        mode: "advisor",
        audience: "front_office",
        status: "ready",
      },
      messages: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not load assistant threads on other tabs", async () => {
    for (const tab of ["overview", "notes", "photos", "timeline"]) {
      const panel = await renderPage({ tab, thread: THREAD });
      expect(panel).toBeNull();
    }
    expect(mocks.listThreads).not.toHaveBeenCalled();
    expect(mocks.loadThread).not.toHaveBeenCalled();
  });

  it("loads the list and selected workspace on the assistant tab", async () => {
    const panel = await renderPage({ tab: "assistant", thread: THREAD });
    expect(mocks.listThreads).toHaveBeenCalledWith(WO, undefined);
    expect(mocks.loadThread).toHaveBeenCalledWith(WO, THREAD, undefined);
    expect(panel).toMatchObject({
      route: { surface: "office", workOrderId: WO },
      selectedThreadId: THREAD,
      jobs: [{ jobId: JOB, label: "Brake service" }],
      defaultJobId: null,
      config: { configured: true, modelLabel: "gpt-6-astra", reason: null },
      capabilities: {
        canMutate: true,
        canUseFrontOfficeModes: true,
        canPromoteNotes: true,
        lockReason: null,
      },
    });
    expect((panel?.threads as unknown[]).length).toBe(1);
    expect(JSON.stringify(panel)).not.toMatch(/sk-test-secret|jane@example|647-555/);
  });

  it("shows history without a selected thread and ignores an invalid thread id", async () => {
    const panel = await renderPage({ tab: "assistant", thread: "not-a-uuid" });
    expect(mocks.listThreads).toHaveBeenCalled();
    expect(mocks.loadThread).not.toHaveBeenCalled();
    expect(panel).toMatchObject({ selectedThreadId: null, workspace: null });
  });

  it("shapes reads and capabilities from the previewed role", async () => {
    const panel = await renderPage({ tab: "assistant", thread: THREAD }, "admin", true);
    const view = { role: "admin", subjectUserId: SUBJECT };
    expect(mocks.listThreads).toHaveBeenCalledWith(WO, view);
    expect(mocks.loadThread).toHaveBeenCalledWith(WO, THREAD, view);
    expect(panel?.capabilities).toMatchObject({
      canMutate: false,
      preview: true,
      lockReason: "preview",
      canPromoteNotes: false,
    });
  });

  it("marks foreign and locked work orders read-only", async () => {
    mocks.getWorkOrderDetail.mockResolvedValue(detail({ is_foreign_location: true }));
    let panel = await renderPage({ tab: "assistant" });
    expect(panel?.capabilities).toMatchObject({
      canMutate: false,
      readOnly: true,
      lockReason: "foreign",
    });

    mocks.getWorkOrderDetail.mockResolvedValue(detail({ status: "completed" }));
    panel = await renderPage({ tab: "assistant" });
    expect(panel?.capabilities).toMatchObject({ readOnly: true, lockReason: "locked" });
  });
});
