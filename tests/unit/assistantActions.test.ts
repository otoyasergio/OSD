import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createThread,
  listThreads,
  loadThread,
  authorizeThreadWrite,
  submitTurn,
  retryLatestFailed,
  promoteReviewedTechnicianNote,
  uploadIntakePhoto,
  revalidatePath,
  getRolePreviewContext,
} = vi.hoisted(() => ({
  createThread: vi.fn(),
  listThreads: vi.fn(),
  loadThread: vi.fn(),
  authorizeThreadWrite: vi.fn(),
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
      listThreads,
      loadThread,
      authorizeThreadWrite,
      submitTurn,
      retryLatestFailed,
    }),
  };
});
vi.mock("@/lib/services/notes", () => ({ promoteReviewedTechnicianNote }));
vi.mock("@/lib/services/photos", () => ({ uploadIntakePhoto }));

import {
  createAssistantThreadAction,
  listAssistantThreadsAction,
  loadAssistantThreadAction,
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
    authorizeThreadWrite.mockResolvedValue({
      thread: { jobId: JOB },
      messages: [],
    });
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

  it("authorizes exact thread writes before selected-photo upload", async () => {
    const form = new FormData();
    form.set("thread_id", THREAD);
    form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));
    authorizeThreadWrite.mockRejectedValue(new Error("FOREIGN_LOCATION"));

    const result = await uploadAssistantPhotoAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(result.status).toBe("error");
    expect(authorizeThreadWrite).toHaveBeenCalledWith(WO, THREAD);
    expect(loadThread).not.toHaveBeenCalled();
    expect(uploadIntakePhoto).not.toHaveBeenCalled();
  });

  it("passes owner role-preview read shaping to list and load", async () => {
    getRolePreviewContext.mockResolvedValue(preview(true));
    listThreads.mockResolvedValue([]);
    loadThread.mockResolvedValue({ thread: {}, messages: [] });

    await listAssistantThreadsAction(WO);
    await loadAssistantThreadAction(WO, THREAD);

    expect(listThreads).toHaveBeenCalledWith(WO, {
      role: "technician",
      subjectUserId: "11111111-1111-4111-8111-111111111111",
    });
    expect(loadThread).toHaveBeenCalledWith(WO, THREAD, {
      role: "technician",
      subjectUserId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("maps raw database errors to a stable generic action message", async () => {
    createThread.mockRejectedValue(
      new Error("duplicate key value violates internal constraint secret_name")
    );
    const form = new FormData();
    form.set("mode", "shop");
    form.set("job_id", JOB);

    const result = await createAssistantThreadAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(result.error).toMatch(/could not complete/i);
    expect(result.error).not.toContain("secret_name");
  });

  it("does not expose uppercase database transport codes", async () => {
    createThread.mockRejectedValue(new Error("PGRST116"));
    const form = new FormData();
    form.set("mode", "shop");
    form.set("job_id", JOB);

    const result = await createAssistantThreadAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(result.error).toMatch(/could not complete/i);
    expect(result.error).not.toContain("PGRST116");
  });

  it("maps duplicate selected photos to a human message", async () => {
    const form = new FormData();
    form.set("thread_id", THREAD);
    form.set("job_id", JOB);
    form.set("mode", "shop");
    form.set("text", "Check it");
    form.set(
      "photos",
      JSON.stringify([
        { photoId: MESSAGE, purpose: "one" },
        { photoId: MESSAGE, purpose: "two" },
      ])
    );

    const result = await submitAssistantTurnAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(result.error).toMatch(/each photo only once/i);
    expect(submitTurn).not.toHaveBeenCalled();
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
