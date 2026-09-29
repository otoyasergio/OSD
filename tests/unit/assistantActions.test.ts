import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createThread,
  loadThread,
  submitTurn,
  retryLatestFailed,
  promoteReviewedTechnicianNote,
  uploadIntakePhoto,
  revalidatePath,
  getRolePreviewContext,
} = vi.hoisted(() => ({
  createThread: vi.fn(),
  loadThread: vi.fn(),
  submitTurn: vi.fn(),
  retryLatestFailed: vi.fn(),
  promoteReviewedTechnicianNote: vi.fn(),
  uploadIntakePhoto: vi.fn(),
  revalidatePath: vi.fn(),
  getRolePreviewContext: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/role-preview", () => ({ getRolePreviewContext }));
vi.mock("@/lib/services/diagnosticsAssistant", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/services/diagnosticsAssistant")>();
  return {
    ...original,
    createDiagnosticsAssistantService: () => ({
      createThread,
      loadThread,
      submitTurn,
      retryLatestFailed,
    }),
  };
});
vi.mock("@/lib/services/notes", () => ({ promoteReviewedTechnicianNote }));
vi.mock("@/lib/services/photos", () => ({ uploadIntakePhoto }));

import {
  createAssistantThreadAction,
  promoteAssistantNoteAction,
  retryAssistantTurnAction,
  submitAssistantTurnAction,
  uploadAssistantPhotoAction,
} from "@/app/(app)/work_orders/assistant-actions";

const WO = "41111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const MESSAGE = "61111111-1111-4111-8111-111111111111";

function preview(isPreviewing: boolean) {
  return {
    actor: {
      user_id: "11111111-1111-4111-8111-111111111111",
      role: "owner",
    },
    role: "technician",
    subjectUserId: "11111111-1111-4111-8111-111111111111",
    subjectLabel: null,
    isPreviewing,
  };
}

describe("Ask OTOMOTO server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRolePreviewContext.mockResolvedValue(preview(false));
  });

  it.each([
    ["create", createAssistantThreadAction, { mode: "shop", job_id: JOB }],
    [
      "submit",
      submitAssistantTurnAction,
      {
        thread_id: THREAD,
        job_id: JOB,
        mode: "shop",
        text: "Check the battery",
        photos: "[]",
      },
    ],
    ["retry", retryAssistantTurnAction, { thread_id: THREAD }],
    [
      "promote",
      promoteAssistantNoteAction,
      {
        source_message_id: MESSAGE,
        job_id: JOB,
        note_type: "diagnostic_finding",
        text: "Reviewed finding",
      },
    ],
  ])("blocks %s while owner role preview is active", async (_name, action, fields) => {
    getRolePreviewContext.mockResolvedValue(preview(true));
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => form.set(key, value));

    const result = await action(WO, { status: "idle", error: null }, form);

    expect(result).toEqual({
      status: "error",
      error: expect.stringMatching(/preview/i),
    });
    expect(createThread).not.toHaveBeenCalled();
    expect(submitTurn).not.toHaveBeenCalled();
    expect(retryLatestFailed).not.toHaveBeenCalled();
    expect(promoteReviewedTechnicianNote).not.toHaveBeenCalled();
  });

  it("blocks selected photo upload during preview before storage side effects", async () => {
    getRolePreviewContext.mockResolvedValue(preview(true));
    const form = new FormData();
    form.set("thread_id", THREAD);
    form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));

    const result = await uploadAssistantPhotoAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(result.status).toBe("error");
    expect(uploadIntakePhoto).not.toHaveBeenCalled();
  });

  it("submits only the diagnostic turn and revalidates read surfaces", async () => {
    submitTurn.mockResolvedValue({ messageId: MESSAGE });
    const form = new FormData();
    form.set("thread_id", THREAD);
    form.set("job_id", JOB);
    form.set("mode", "shop");
    form.set("text", "Check the battery");
    form.set("photos", "[]");

    const result = await submitAssistantTurnAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(result.status).toBe("success");
    expect(submitTurn).toHaveBeenCalledOnce();
    expect(createThread).not.toHaveBeenCalled();
    expect(promoteReviewedTechnicianNote).not.toHaveBeenCalled();
    expect(uploadIntakePhoto).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/work_orders/${WO}`);
    expect(revalidatePath).toHaveBeenCalledWith("/technician");
  });
});
