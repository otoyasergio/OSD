import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WO = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const OTHER_JOB = "52222222-2222-4222-8222-222222222222";
const THREAD = "71111111-1111-4111-8111-111111111111";
const SUBJECT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "19999999-9999-4999-8999-999999999999";

const {
  getRolePreviewContext,
  getJobPacket,
  listIntakePhotos,
  loadThread,
  listThreads,
  getTechnicianFloorOs,
  getTechnicianDocket,
  listReadyForPickup,
} = vi.hoisted(() => ({
  getRolePreviewContext: vi.fn(),
  getJobPacket: vi.fn(),
  listIntakePhotos: vi.fn(),
  loadThread: vi.fn(),
  listThreads: vi.fn(),
  getTechnicianFloorOs: vi.fn(),
  getTechnicianDocket: vi.fn(),
  listReadyForPickup: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/auth/role-preview", () => ({ getRolePreviewContext }));
vi.mock("@/lib/services/jobPacket", () => ({ getJobPacket }));
vi.mock("@/lib/services/photos", () => ({ listIntakePhotos }));
vi.mock("@/lib/services/technicianFloor", () => ({
  emptyFloorOs: () => ({ selected: null }),
  getTechnicianFloorOs,
}));
vi.mock("@/lib/services/technicianDocket", () => ({ getTechnicianDocket }));
vi.mock("@/lib/services/readyForPickup", () => ({ listReadyForPickup }));
vi.mock("@/lib/services/diagnosticsAssistant", () => ({
  createDiagnosticsAssistantService: () => ({ loadThread, listThreads }),
}));
vi.mock("@/components/technician/TechnicianFloorShell", () => ({
  TechnicianFloorShell: () => null,
}));

import TechnicianPage from "@/app/(app)/technician/page";

function preview(role: string, isPreviewing: boolean) {
  return {
    actor: {
      user_id: isPreviewing ? ACTOR : SUBJECT,
      role: isPreviewing ? "owner" : role,
    },
    role,
    subjectUserId: SUBJECT,
    subjectLabel: null,
    isPreviewing,
  };
}

const fullPhoto = (id: string, category: string, jobId: string | null) => ({
  photo_id: id,
  work_order_id: WO,
  uploaded_by_user_id: "u1",
  storage_path: `${WO}/${category}/${id}.jpg`,
  thumb_storage_path: `${WO}/${category}/${id}_t.jpg`,
  photo_url: "https://legacy.example/full.jpg",
  category,
  notes: "Customer Jane Doe 647-555-0100",
  inspection_result_id: null,
  job_id: jobId,
  created_at: "2026-09-29T14:05:00.000Z",
  signed_url: "https://signed.example/full.jpg",
  thumb_url: `https://signed.example/${id}.jpg`,
  uploaded_by: { user_id: "u1", first_name: "Sam", last_name: "Tech" },
});

const threadSummary = (overrides: Record<string, unknown> = {}) => ({
  threadId: THREAD,
  workOrderId: WO,
  jobId: JOB,
  locationId: "31111111-1111-4111-8111-111111111111",
  mode: "shop",
  audience: "technical",
  status: "ready",
  diagnosticPhase: null,
  triggerType: null,
  createdAt: "2026-09-29T10:00:00.000Z",
  updatedAt: "2026-09-29T10:00:00.000Z",
  ...overrides,
});

type PacketAssistant = {
  route: Record<string, unknown>;
  threads: Array<Record<string, unknown>>;
  selectedThreadId: string | null;
  workspace: { thread: { threadId: string } } | null;
  jobs: Array<{ jobId: string; label: string }>;
  defaultJobId: string | null;
  photos: Array<Record<string, unknown>>;
  config: { configured: boolean; modelLabel: string | null; reason: string | null };
  capabilities: Record<string, unknown>;
};

async function shellProps(
  role: string,
  isPreviewing: boolean,
  params: Record<string, string> = {}
) {
  getRolePreviewContext.mockResolvedValue(preview(role, isPreviewing));
  const element = (await TechnicianPage({
    searchParams: Promise.resolve({
      wo: WO,
      job: JOB,
      stage: "proof",
      panel: "packet",
      packetSection: "assistant",
      assistantThread: THREAD,
      ...params,
    }),
  })) as { props: Record<string, unknown> };
  return element.props as Record<string, unknown> & {
    packetAssistant: PacketAssistant | null;
  };
}

describe("technician page Ask OTOMOTO wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "sk-test-secret");
    getTechnicianFloorOs.mockResolvedValue({ selected: null });
    getTechnicianDocket.mockResolvedValue({ items: [] });
    listReadyForPickup.mockResolvedValue([]);
    getJobPacket.mockResolvedValue({
      work_order_id: WO,
      wo_status: "in_progress",
      jobs: [
        { job_id: JOB, service_name: "Brake service", assigned_to_me: true },
        { job_id: OTHER_JOB, service_name: "Tire swap", assigned_to_me: false },
      ],
    });
    listIntakePhotos.mockResolvedValue([
      fullPhoto("a1111111-1111-4111-8111-111111111111", "job_work", JOB),
      fullPhoto("a2222222-2222-4222-8222-222222222222", "vin", null),
      fullPhoto("a3333333-3333-4333-8333-333333333333", "job_work", OTHER_JOB),
      fullPhoto("a4444444-4444-4444-8444-444444444444", "inspection_brakes", null),
    ]);
    listThreads.mockResolvedValue([threadSummary()]);
    loadThread.mockResolvedValue({ thread: threadSummary(), messages: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets a technician mutate outside preview without front-office modes", async () => {
    const { packetAssistant } = await shellProps("technician", false);
    expect(packetAssistant?.capabilities).toEqual({
      canMutate: true,
      preview: false,
      readOnly: false,
      lockReason: null,
      canUseFrontOfficeModes: false,
      canPromoteNotes: true,
    });
    expect(packetAssistant?.config).toEqual({
      configured: true,
      modelLabel: "gpt-6-astra",
      reason: null,
    });
    expect(JSON.stringify(packetAssistant)).not.toContain("sk-test-secret");
  });

  it("keeps the exact floor route and offers only the current job", async () => {
    const { packetAssistant } = await shellProps("technician", false);
    expect(packetAssistant?.route).toEqual({
      surface: "floor",
      workOrderId: WO,
      jobId: JOB,
      stage: "proof",
    });
    expect(packetAssistant?.jobs).toEqual([{ jobId: JOB, label: "Brake service" }]);
    expect(packetAssistant?.defaultJobId).toBe(JOB);
    expect(packetAssistant?.selectedThreadId).toBe(THREAD);
    expect(packetAssistant?.threads[0]).toMatchObject({
      threadId: THREAD,
      jobLabel: "Brake service",
    });
  });

  it("ignores a route job that is not on this work order", async () => {
    const { packetAssistant } = await shellProps("technician", false, {
      job: "59999999-9999-4999-8999-999999999999",
    });
    expect(packetAssistant?.jobs).toEqual([]);
    expect(packetAssistant?.defaultJobId).toBeNull();
  });

  it.each(["technician", "service_advisor", "manager"])(
    "shapes reads as the previewed %s and never allows mutation",
    async (role) => {
      const { packetAssistant } = await shellProps(role, true);
      expect(packetAssistant?.capabilities).toMatchObject({
        canMutate: false,
        preview: true,
        readOnly: false,
        lockReason: "preview",
        canUseFrontOfficeModes: false,
        canPromoteNotes: false,
      });
      const view = { role, subjectUserId: SUBJECT };
      expect(listThreads).toHaveBeenCalledWith(WO, view);
      expect(loadThread).toHaveBeenCalledWith(WO, THREAD, view);
    }
  );

  it("treats a completed work order as locked", async () => {
    getJobPacket.mockResolvedValue({
      work_order_id: WO,
      wo_status: "completed",
      jobs: [],
    });
    const { packetAssistant } = await shellProps("technician", false);
    expect(packetAssistant?.capabilities).toMatchObject({
      canMutate: false,
      readOnly: true,
      lockReason: "locked",
    });
  });

  it("reports missing AI configuration without exposing settings", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { packetAssistant } = await shellProps("technician", false);
    expect(packetAssistant?.config.configured).toBe(false);
  });

  it("passes only sanitized eligible assistant photos, separate from the full photo list", async () => {
    const { packetAssistant } = await shellProps("technician", false);

    expect(packetAssistant?.photos).toEqual([
      {
        photo_id: "a1111111-1111-4111-8111-111111111111",
        work_order_id: WO,
        job_id: JOB,
        category: "job_work",
        created_at: "2026-09-29T14:05:00.000Z",
        thumb_url: "https://signed.example/a1111111-1111-4111-8111-111111111111.jpg",
      },
      {
        photo_id: "a4444444-4444-4444-8444-444444444444",
        work_order_id: WO,
        job_id: null,
        category: "inspection_brakes",
        created_at: "2026-09-29T14:05:00.000Z",
        thumb_url: "https://signed.example/a4444444-4444-4444-8444-444444444444.jpg",
      },
    ]);
    expect(JSON.stringify(packetAssistant?.photos)).not.toMatch(
      /storage_path|Jane|647|Sam|legacy|full\.jpg/
    );
  });

  it("loads assistant data only after packet access and only for the assistant section", async () => {
    getJobPacket.mockRejectedValue(new Error("FORBIDDEN"));
    let props = await shellProps("technician", false);
    expect(listIntakePhotos).not.toHaveBeenCalled();
    expect(listThreads).not.toHaveBeenCalled();
    expect(props.packetAssistant).toBeNull();

    vi.clearAllMocks();
    getJobPacket.mockResolvedValue({
      work_order_id: WO,
      wo_status: "in_progress",
      jobs: [],
    });
    listIntakePhotos.mockResolvedValue([]);
    props = await shellProps("technician", false, { packetSection: "notes" });
    expect(listThreads).not.toHaveBeenCalled();
    expect(loadThread).not.toHaveBeenCalled();
    expect(props.packetAssistant).toBeNull();
  });

  it("shows history with no workspace when no thread is selected or it is stale", async () => {
    let props = await shellProps("technician", false, { assistantThread: "" });
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(loadThread).not.toHaveBeenCalled();
    expect(props.packetAssistant?.workspace).toBeNull();
    expect(props.packetAssistant?.selectedThreadId).toBeNull();

    loadThread.mockRejectedValue(new Error("ASK_OTOMOTO_THREAD_NOT_FOUND"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    props = await shellProps("technician", false);
    expect(props.packetAssistant?.workspace).toBeNull();
    expect(props.packetAssistant?.selectedThreadId).toBe(THREAD);
    expect(props.packetAssistant?.photos).toEqual([]);
    expect(props.packetAssistant?.threads).toHaveLength(1);
  });
});
