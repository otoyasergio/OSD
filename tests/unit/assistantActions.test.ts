import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createThread,
  listThreads,
  loadThread,
  authorizeThreadWrite,
  submitTurn,
  retryLatestFailed,
  authorizeAutomaticTriggerRecovery,
  generateTriggerResponse,
  promoteReviewedTechnicianNote,
  uploadIntakePhoto,
  revalidatePath,
  getRolePreviewContext,
  after,
  scheduled,
} = vi.hoisted(() => ({
  createThread: vi.fn(),
  listThreads: vi.fn(),
  loadThread: vi.fn(),
  authorizeThreadWrite: vi.fn(),
  submitTurn: vi.fn(),
  retryLatestFailed: vi.fn(),
  authorizeAutomaticTriggerRecovery: vi.fn(),
  generateTriggerResponse: vi.fn(),
  promoteReviewedTechnicianNote: vi.fn(),
  uploadIntakePhoto: vi.fn(),
  revalidatePath: vi.fn(),
  getRolePreviewContext: vi.fn(),
  scheduled: [] as Array<() => Promise<void> | void>,
  after: vi.fn((callback: () => Promise<void> | void) => {
    scheduled.push(callback);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/server", () => ({ after }));
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
      authorizeAutomaticTriggerRecovery,
    }),
    generateDiagnosticsTriggerResponseInternal: generateTriggerResponse,
  };
});
vi.mock("@/lib/services/notes", () => ({ promoteReviewedTechnicianNote }));
vi.mock("@/lib/services/photos", () => ({ uploadIntakePhoto }));

import {
  createAssistantThreadAction,
  promoteAssistantNoteAction,
  retryAssistantTurnAction,
  runAutomaticAssistantReviewAction,
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
    scheduled.length = 0;
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
    ["automatic recovery", runAutomaticAssistantReviewAction, { thread_id: THREAD }],
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
    expect(authorizeAutomaticTriggerRecovery).not.toHaveBeenCalled();
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
    form.set("purpose", "Caliper");
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

  it("stores a selected-photo upload as job_work pinned to the exact thread job", async () => {
    uploadIntakePhoto.mockResolvedValue({
      photo_id: MESSAGE,
      work_order_id: WO,
      job_id: JOB,
      category: "job_work",
      notes: "Caliper piston",
      created_at: "2026-09-29T00:00:00.000Z",
      storage_path: `${WO}/job_work/${MESSAGE}.jpg`,
      thumb_storage_path: `${WO}/job_work/${MESSAGE}_thumb.jpg`,
      signed_url: "https://signed.example/full.jpg",
      thumb_url: "https://signed.example/thumb.jpg",
      uploaded_by_user_id: "11111111-1111-4111-8111-111111111111",
    });
    const form = new FormData();
    form.set("thread_id", THREAD);
    form.set("purpose", "Caliper piston");
    form.set("category", "vin");
    form.set("job_id", "52222222-2222-4222-8222-222222222222");
    form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));

    const result = await uploadAssistantPhotoAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(authorizeThreadWrite).toHaveBeenCalledWith(WO, THREAD);
    expect(uploadIntakePhoto).toHaveBeenCalledWith(
      WO,
      expect.objectContaining({
        category: "job_work",
        job_id: JOB,
        notes: "Caliper piston",
        inspection_result_id: null,
      })
    );
    expect(result).toEqual({
      status: "success",
      error: null,
      data: {
        photoId: MESSAGE,
        workOrderId: WO,
        jobId: JOB,
        category: "job_work",
        notes: "Caliper piston",
        createdAt: "2026-09-29T00:00:00.000Z",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/storage_path|signed\.example|https?:/);
  });

  it("passes the client upload ID and returns it with the existing photo payload", async () => {
    const clientUploadId = "81111111-1111-4111-8111-111111111111";
    uploadIntakePhoto.mockResolvedValue({
      photo_id: MESSAGE,
      work_order_id: WO,
      job_id: JOB,
      category: "job_work",
      notes: "Caliper piston",
      created_at: "2026-09-29T00:00:00.000Z",
      client_upload_id: clientUploadId,
    });
    const form = new FormData();
    form.set("thread_id", THREAD);
    form.set("purpose", "Caliper piston");
    form.set("client_upload_id", clientUploadId);
    form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));

    const result = await uploadAssistantPhotoAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(uploadIntakePhoto).toHaveBeenCalledWith(
      WO,
      expect.objectContaining({
        client_upload_id: clientUploadId,
        category: "job_work",
        job_id: JOB,
      })
    );
    expect(result).toEqual({
      status: "success",
      error: null,
      data: {
        photoId: MESSAGE,
        workOrderId: WO,
        jobId: JOB,
        category: "job_work",
        notes: "Caliper piston",
        createdAt: "2026-09-29T00:00:00.000Z",
        clientUploadId,
      },
    });
  });

  it("rejects photo upload for a work-order-only thread before storage", async () => {
    authorizeThreadWrite.mockResolvedValue({ thread: { jobId: null }, messages: [] });
    const form = new FormData();
    form.set("thread_id", THREAD);
    form.set("purpose", "Caliper");
    form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));

    const result = await uploadAssistantPhotoAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(result).toEqual({
      status: "error",
      error: "Select the matching job before attaching a job work or proof photo.",
    });
    expect(uploadIntakePhoto).not.toHaveBeenCalled();
  });

  describe("upload purpose validation", () => {
    function uploadForm(purpose?: string) {
      const form = new FormData();
      form.set("thread_id", THREAD);
      if (purpose !== undefined) form.set("purpose", purpose);
      form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));
      return form;
    }
    const PURPOSE_ERROR =
      "Describe why each selected photo is relevant in 500 characters or fewer.";

    it.each([
      ["missing", undefined],
      ["blank", "   "],
      ["too long", "x".repeat(501)],
      ["control characters", "bad\u0000purpose"],
    ])("rejects a %s purpose before storing anything", async (_name, purpose) => {
      const result = await uploadAssistantPhotoAction(
        WO,
        { status: "idle", error: null },
        uploadForm(purpose)
      );

      expect(result).toEqual({ status: "error", error: PURPOSE_ERROR });
      expect(uploadIntakePhoto).not.toHaveBeenCalled();
    });

    it("normalizes newline/tab whitespace instead of dead-ending the upload", async () => {
      uploadIntakePhoto.mockResolvedValue({
        photo_id: MESSAGE,
        work_order_id: WO,
        job_id: JOB,
        category: "job_work",
        notes: "x",
        created_at: "2026-09-29T00:00:00.000Z",
      });
      const result = await uploadAssistantPhotoAction(
        WO,
        { status: "idle", error: null },
        uploadForm("  Show the\n left\tcaliper\r\n   piston  ")
      );

      expect(result.status).toBe("success");
      expect(uploadIntakePhoto).toHaveBeenLastCalledWith(
        WO,
        expect.objectContaining({ notes: "Show the left caliper piston" })
      );
    });

    it("bounds the purpose after whitespace normalization", async () => {
      uploadIntakePhoto.mockResolvedValue({
        photo_id: MESSAGE,
        work_order_id: WO,
        job_id: JOB,
        category: "job_work",
        notes: "x",
        created_at: "2026-09-29T00:00:00.000Z",
      });
      const padded = `ok${" \n\t".repeat(400)}fine`;
      const result = await uploadAssistantPhotoAction(
        WO,
        { status: "idle", error: null },
        uploadForm(padded)
      );
      expect(result.status).toBe("success");
      expect(uploadIntakePhoto).toHaveBeenLastCalledWith(
        WO,
        expect.objectContaining({ notes: "ok fine" })
      );
    });

    it("stores a trimmed, redacted purpose as the photo notes at the 500 limit", async () => {
      uploadIntakePhoto.mockResolvedValue({
        photo_id: MESSAGE,
        work_order_id: WO,
        job_id: JOB,
        category: "job_work",
        notes: "x",
        created_at: "2026-09-29T00:00:00.000Z",
      });
      await uploadAssistantPhotoAction(
        WO,
        { status: "idle", error: null },
        uploadForm("  Call 647-424-1088 or jane@example.com about the caliper  ")
      );
      expect(uploadIntakePhoto).toHaveBeenLastCalledWith(
        WO,
        expect.objectContaining({
          notes: "Call [REDACTED_PHONE] or [REDACTED_EMAIL] about the caliper",
        })
      );

      await uploadAssistantPhotoAction(
        WO,
        { status: "idle", error: null },
        uploadForm("y".repeat(500))
      );
      expect(uploadIntakePhoto).toHaveBeenLastCalledWith(
        WO,
        expect.objectContaining({ notes: "y".repeat(500) })
      );
    });
  });

  it("exposes no callable raw thread read actions", async () => {
    const actions = await import("@/app/(app)/work_orders/assistant-actions");
    expect(Object.keys(actions).sort()).toEqual([
      "createAssistantThreadAction",
      "promoteAssistantNoteAction",
      "retryAssistantTurnAction",
      "runAutomaticAssistantReviewAction",
      "submitAssistantTurnAction",
      "uploadAssistantPhotoAction",
    ]);
  });

  it("re-authorizes and schedules the exact automatic seed without changing domain records", async () => {
    const recovery = {
      actor: {
        userId: "11111111-1111-4111-8111-111111111111",
        locationId: "31111111-1111-4111-8111-111111111111",
      },
      trigger: {
        workOrderId: WO,
        threadId: THREAD,
        jobId: JOB,
        trigger: "job_completion",
        triggerEntityId: JOB,
      },
    };
    authorizeAutomaticTriggerRecovery.mockResolvedValue(recovery);
    generateTriggerResponse.mockResolvedValue(null);
    const form = new FormData();
    form.set("thread_id", THREAD);

    const result = await runAutomaticAssistantReviewAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(result).toEqual({ status: "success", error: null });
    expect(authorizeAutomaticTriggerRecovery).toHaveBeenCalledWith({
      workOrderId: WO,
      threadId: THREAD,
    });
    expect(after).toHaveBeenCalledOnce();
    expect(generateTriggerResponse).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalled();
    await scheduled[0]!();
    expect(generateTriggerResponse).toHaveBeenCalledWith(
      recovery.actor,
      recovery.trigger
    );
  });

  it("keeps a lost scheduled callback recoverable and concurrent recovery idempotent", async () => {
    const recovery = {
      actor: {
        userId: "11111111-1111-4111-8111-111111111111",
        locationId: "31111111-1111-4111-8111-111111111111",
      },
      trigger: {
        workOrderId: WO,
        threadId: THREAD,
        trigger: "inspection_completion",
        triggerEntityId: "e1111111-1111-4111-8111-111111111111",
      },
    };
    authorizeAutomaticTriggerRecovery.mockResolvedValue(recovery);
    generateTriggerResponse.mockResolvedValue(null);
    const form = new FormData();
    form.set("thread_id", THREAD);

    await Promise.all([
      runAutomaticAssistantReviewAction(WO, { status: "idle", error: null }, form),
      runAutomaticAssistantReviewAction(WO, { status: "idle", error: null }, form),
    ]);

    expect(scheduled).toHaveLength(2);
    expect(generateTriggerResponse).not.toHaveBeenCalled();
    await Promise.all(scheduled.map((callback) => callback()));
    expect(generateTriggerResponse).toHaveBeenCalledTimes(2);
  });

  it("does not schedule or refresh a locked automatic recovery", async () => {
    authorizeAutomaticTriggerRecovery.mockRejectedValue(
      new Error("DIAGNOSTICS_AI_NOT_CONFIGURED")
    );
    const form = new FormData();
    form.set("thread_id", THREAD);

    const result = await runAutomaticAssistantReviewAction(
      WO,
      { status: "idle", error: null },
      form
    );

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/not configured/i);
    expect(after).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
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
