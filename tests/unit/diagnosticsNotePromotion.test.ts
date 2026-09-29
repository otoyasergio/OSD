import { describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/lib/auth/session";
import {
  promoteReviewedTechnicianNote,
  type ReviewedNotePromotionDependencies,
} from "@/lib/services/notes";
import { technicianNoteSchema } from "@/lib/validation/schemas";

const user: AppUser = {
  user_id: "11111111-1111-4111-8111-111111111111",
  auth_user_id: "21111111-1111-4111-8111-111111111111",
  first_name: "Floor",
  last_name: "Tech",
  email: "floor@example.invalid",
  profile_photo_path: null,
  role: "technician",
  status: "active",
  location_ids: ["31111111-1111-4111-8111-111111111111"],
  active_location_id: "31111111-1111-4111-8111-111111111111",
};

function dependencies(): ReviewedNotePromotionDependencies {
  return {
    requireUser: vi.fn().mockResolvedValue(user),
    loadWorkOrder: vi.fn().mockResolvedValue({
      workOrderId: "41111111-1111-4111-8111-111111111111",
      workOrderNumber: "WO-100",
      locationId: "31111111-1111-4111-8111-111111111111",
      status: "in_progress",
      primaryTechnicianId: user.user_id,
      qualityCheckAssignedTo: null,
      jobs: [
        {
          jobId: "51111111-1111-4111-8111-111111111111",
          assignedTechnicianId: user.user_id,
        },
      ],
    }),
    loadSourceMessage: vi.fn().mockResolvedValue({
      messageId: "61111111-1111-4111-8111-111111111111",
      workOrderId: "41111111-1111-4111-8111-111111111111",
      jobId: "51111111-1111-4111-8111-111111111111",
      role: "assistant",
      generationStatus: "ready",
      audience: "technical",
      threadStatus: "ready",
    }),
    findExistingPromotion: vi.fn().mockResolvedValue(null),
    insertNote: vi.fn().mockResolvedValue({
      technician_note_id: "71111111-1111-4111-8111-111111111111",
      work_order_id: "41111111-1111-4111-8111-111111111111",
      job_id: "51111111-1111-4111-8111-111111111111",
      created_by_user_id: user.user_id,
      source_ai_message_id: "61111111-1111-4111-8111-111111111111",
      note: "Edited and verified finding",
      note_type: "diagnostic_finding",
      created_at: "2026-09-29T00:00:00.000Z",
    }),
    recordTimeline: vi.fn(),
    recordAudit: vi.fn(),
  };
}

describe("reviewed Ask OTOMOTO note promotion", () => {
  it("inserts append-only edited text with source provenance and audit/timeline", async () => {
    const deps = dependencies();
    const note = await promoteReviewedTechnicianNote(
      "41111111-1111-4111-8111-111111111111",
      {
        text: " Edited and verified finding ",
        noteType: "diagnostic_finding",
        jobId: "51111111-1111-4111-8111-111111111111",
        sourceMessageId: "61111111-1111-4111-8111-111111111111",
      },
      deps
    );

    expect(note.source_ai_message_id).toBe("61111111-1111-4111-8111-111111111111");
    expect(deps.insertNote).toHaveBeenCalledWith(
      expect.objectContaining({
        note: "Edited and verified finding",
        sourceAiMessageId: "61111111-1111-4111-8111-111111111111",
        createdByUserId: user.user_id,
      })
    );
    expect(deps.recordTimeline).toHaveBeenCalledOnce();
    expect(deps.recordAudit).toHaveBeenCalledOnce();
  });

  it("rejects duplicate promotion before insert", async () => {
    const deps = dependencies();
    vi.mocked(deps.findExistingPromotion).mockResolvedValue(
      "71111111-1111-4111-8111-111111111111"
    );

    await expect(
      promoteReviewedTechnicianNote(
        "41111111-1111-4111-8111-111111111111",
        {
          text: "Edited and verified finding",
          noteType: "diagnostic_finding",
          jobId: "51111111-1111-4111-8111-111111111111",
          sourceMessageId: "61111111-1111-4111-8111-111111111111",
        },
        deps
      )
    ).rejects.toThrow("ASK_OTOMOTO_NOTE_ALREADY_PROMOTED");
    expect(deps.insertNote).not.toHaveBeenCalled();
  });

  it.each(["proof_exception", "road_test", "quality_check"] as const)(
    "rejects workflow-gating note type %s",
    async (noteType) => {
      const deps = dependencies();
      await expect(
        promoteReviewedTechnicianNote(
          "41111111-1111-4111-8111-111111111111",
          {
            text: "Must not satisfy a workflow gate",
            noteType: noteType as never,
            jobId: "51111111-1111-4111-8111-111111111111",
            sourceMessageId: "61111111-1111-4111-8111-111111111111",
          },
          deps
        )
      ).rejects.toThrow();
      expect(deps.insertNote).not.toHaveBeenCalled();
    }
  );

  it("leaves manual proof_exception notes available to the workflow gate", () => {
    expect(
      technicianNoteSchema.parse({
        note: "Technician documented the proof exception",
        note_type: "proof_exception",
        job_id: "51111111-1111-4111-8111-111111111111",
      }).note_type
    ).toBe("proof_exception");
  });

  it("requires the exact non-null job for a job-scoped source", async () => {
    const deps = dependencies();

    await expect(
      promoteReviewedTechnicianNote(
        "41111111-1111-4111-8111-111111111111",
        {
          text: "Reviewed finding",
          noteType: "diagnostic_finding",
          jobId: null,
          sourceMessageId: "61111111-1111-4111-8111-111111111111",
        },
        deps
      )
    ).rejects.toThrow("ASK_OTOMOTO_NOTE_JOB_MISMATCH");
    expect(deps.insertNote).not.toHaveBeenCalled();
  });

  it("requires the actor's current active location even for floor staff", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadWorkOrder).mockResolvedValue({
      workOrderId: "41111111-1111-4111-8111-111111111111",
      workOrderNumber: "WO-100",
      locationId: "81111111-1111-4111-8111-111111111111",
      status: "in_progress",
      primaryTechnicianId: user.user_id,
      qualityCheckAssignedTo: null,
      jobs: [
        {
          jobId: "51111111-1111-4111-8111-111111111111",
          assignedTechnicianId: user.user_id,
        },
      ],
    });
    vi.mocked(deps.requireUser).mockResolvedValue({
      ...user,
      location_ids: [user.active_location_id!, "81111111-1111-4111-8111-111111111111"],
    });

    await expect(
      promoteReviewedTechnicianNote(
        "41111111-1111-4111-8111-111111111111",
        {
          text: "Reviewed finding",
          noteType: "diagnostic_finding",
          jobId: "51111111-1111-4111-8111-111111111111",
          sourceMessageId: "61111111-1111-4111-8111-111111111111",
        },
        deps
      )
    ).rejects.toThrow("FOREIGN_LOCATION");
    expect(deps.insertNote).not.toHaveBeenCalled();
  });

  it("keeps a successful append when metadata logging fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.recordTimeline).mockRejectedValue(new Error("timeline unavailable"));
    vi.mocked(deps.recordAudit).mockRejectedValue(new Error("audit unavailable"));

    await expect(
      promoteReviewedTechnicianNote(
        "41111111-1111-4111-8111-111111111111",
        {
          text: "Reviewed finding",
          noteType: "diagnostic_finding",
          jobId: "51111111-1111-4111-8111-111111111111",
          sourceMessageId: "61111111-1111-4111-8111-111111111111",
        },
        deps
      )
    ).resolves.toMatchObject({
      source_ai_message_id: "61111111-1111-4111-8111-111111111111",
    });
  });

  it.each([
    [{ audience: "front_office" }, "ASK_OTOMOTO_NOTE_SOURCE_NOT_TECHNICAL"],
    [{ generationStatus: "failed" }, "ASK_OTOMOTO_NOTE_SOURCE_NOT_READY"],
    [{ role: "user" }, "ASK_OTOMOTO_NOTE_SOURCE_NOT_ASSISTANT"],
    [{ threadStatus: "archived" }, "ASK_OTOMOTO_THREAD_ARCHIVED"],
    [
      { workOrderId: "81111111-1111-4111-8111-111111111111" },
      "ASK_OTOMOTO_NOTE_SOURCE_NOT_FOUND",
    ],
  ])("rejects invalid source provenance %#", async (sourceOverride, code) => {
    const deps = dependencies();
    vi.mocked(deps.loadSourceMessage).mockResolvedValue({
      messageId: "61111111-1111-4111-8111-111111111111",
      workOrderId: "41111111-1111-4111-8111-111111111111",
      jobId: null,
      role: "assistant",
      generationStatus: "ready",
      audience: "technical",
      threadStatus: "ready",
      ...sourceOverride,
    });

    await expect(
      promoteReviewedTechnicianNote(
        "41111111-1111-4111-8111-111111111111",
        {
          text: "Edited finding",
          noteType: "diagnostic_finding",
          jobId: null,
          sourceMessageId: "61111111-1111-4111-8111-111111111111",
        },
        deps
      )
    ).rejects.toThrow(code);
    expect(deps.insertNote).not.toHaveBeenCalled();
  });
});
