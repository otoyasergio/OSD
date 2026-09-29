import { beforeEach, describe, expect, it, vi } from "vitest";

const WO = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";
const SUBJECT = "11111111-1111-4111-8111-111111111111";

const {
  getRolePreviewContext,
  getJobPacket,
  listIntakePhotos,
  loadThread,
  getTechnicianFloorOs,
  getTechnicianDocket,
  listReadyForPickup,
} = vi.hoisted(() => ({
  getRolePreviewContext: vi.fn(),
  getJobPacket: vi.fn(),
  listIntakePhotos: vi.fn(),
  loadThread: vi.fn(),
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
  createDiagnosticsAssistantService: () => ({ loadThread }),
}));
vi.mock("@/components/technician/TechnicianFloorShell", () => ({
  TechnicianFloorShell: () => null,
}));

import TechnicianPage from "@/app/(app)/technician/page";

function preview(role: string, isPreviewing: boolean) {
  return {
    actor: { user_id: SUBJECT, role: isPreviewing ? "owner" : role },
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

async function shellProps(role: string, isPreviewing: boolean) {
  getRolePreviewContext.mockResolvedValue(preview(role, isPreviewing));
  const element = (await TechnicianPage({
    searchParams: Promise.resolve({
      wo: WO,
      job: JOB,
      panel: "packet",
      packetSection: "assistant",
      assistantThread: THREAD,
    }),
  })) as { props: Record<string, unknown> };
  return element.props;
}

describe("technician page Ask OTOMOTO wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTechnicianFloorOs.mockResolvedValue({ selected: null });
    getTechnicianDocket.mockResolvedValue({ items: [] });
    listReadyForPickup.mockResolvedValue([]);
    getJobPacket.mockResolvedValue({
      work_order_id: WO,
      wo_status: "in_progress",
      jobs: [],
    });
    listIntakePhotos.mockResolvedValue([
      fullPhoto("a1111111-1111-4111-8111-111111111111", "job_work", JOB),
      fullPhoto("a2222222-2222-4222-8222-222222222222", "vin", null),
      fullPhoto(
        "a3333333-3333-4333-8333-333333333333",
        "job_work",
        "52222222-2222-4222-8222-222222222222"
      ),
      fullPhoto("a4444444-4444-4444-8444-444444444444", "inspection_brakes", null),
    ]);
    loadThread.mockResolvedValue({
      thread: { threadId: THREAD, workOrderId: WO, jobId: JOB },
      messages: [],
    });
  });

  it("lets a technician mutate outside preview", async () => {
    const props = await shellProps("technician", false);
    expect(props.packetAssistantFlags).toEqual({
      canMutate: true,
      preview: false,
      readOnly: false,
    });
  });

  it.each(["technician", "service_advisor", "manager"])(
    "marks an owner previewing %s as preview and never mutable",
    async (role) => {
      const props = await shellProps(role, true);
      expect(props.packetAssistantFlags).toEqual({
        canMutate: false,
        preview: true,
        readOnly: false,
      });
    }
  );

  it("treats a completed work order as read-only", async () => {
    getJobPacket.mockResolvedValue({
      work_order_id: WO,
      wo_status: "completed",
      jobs: [],
    });
    const props = await shellProps("technician", false);
    expect(props.packetAssistantFlags).toMatchObject({
      canMutate: false,
      readOnly: true,
    });
  });

  it("passes only sanitized eligible assistant photos, separate from the full photo list", async () => {
    const props = await shellProps("technician", false);

    expect(props.packetAssistantPhotos).toEqual([
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
    expect(JSON.stringify(props.packetAssistantPhotos)).not.toMatch(
      /storage_path|Jane|647|Sam|legacy|full\.jpg/
    );
  });

  it("loads photos only after packet access and passes none for a stale thread", async () => {
    getJobPacket.mockRejectedValue(new Error("FORBIDDEN"));
    let props = await shellProps("technician", false);
    expect(listIntakePhotos).not.toHaveBeenCalled();
    expect(props.packetAssistantPhotos).toEqual([]);

    getJobPacket.mockResolvedValue({
      work_order_id: WO,
      wo_status: "in_progress",
      jobs: [],
    });
    loadThread.mockRejectedValue(new Error("ASK_OTOMOTO_THREAD_NOT_FOUND"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    props = await shellProps("technician", false);
    expect(props.packetAssistantWorkspace).toBeNull();
    expect(props.packetAssistantPhotos).toEqual([]);
  });
});
