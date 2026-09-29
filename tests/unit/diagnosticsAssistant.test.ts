import { describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/lib/auth/session";
import {
  assertDiagnosticsAccess,
  assertDiagnosticsThreadWrite,
  createOrReuseDiagnosticsTriggerThreadInternal,
  createDiagnosticsAssistantService,
  deriveDiagnosticsAudience,
  generateDiagnosticsTriggerResponseInternal,
  INSPECTION_COMPLETION_SEED_REQUEST,
  JOB_COMPLETION_SEED_REQUEST,
  type DiagnosticsAssistantRepository,
  type DiagnosticsWorkOrderScope,
} from "@/lib/services/diagnosticsAssistant";
import type { DiagnosticsContextSource } from "@/lib/diagnostics/context";
import type {
  DiagnosticsGenerationRequest,
  DiagnosticsGenerationResult,
} from "@/lib/diagnostics/openai";

const actor = (role: AppUser["role"], overrides: Partial<AppUser> = {}): AppUser => ({
  user_id: "11111111-1111-4111-8111-111111111111",
  auth_user_id: "21111111-1111-4111-8111-111111111111",
  first_name: "Test",
  last_name: "Staff",
  email: "staff@example.invalid",
  profile_photo_path: null,
  role,
  status: "active",
  location_ids: ["31111111-1111-4111-8111-111111111111"],
  active_location_id: "31111111-1111-4111-8111-111111111111",
  ...overrides,
});

const scope = (
  overrides: Partial<DiagnosticsWorkOrderScope> = {}
): DiagnosticsWorkOrderScope => ({
  workOrderId: "41111111-1111-4111-8111-111111111111",
  locationId: "31111111-1111-4111-8111-111111111111",
  locationStatus: "active",
  status: "in_progress",
  primaryTechnicianId: actor("technician").user_id,
  qualityCheckAssignedTo: null,
  jobs: [
    {
      jobId: "51111111-1111-4111-8111-111111111111",
      assignedTechnicianId: actor("technician").user_id,
    },
  ],
  ...overrides,
});

describe("Ask OTOMOTO authorization", () => {
  it("derives audience solely from mode", () => {
    expect(deriveDiagnosticsAudience("shop")).toBe("technical");
    expect(deriveDiagnosticsAudience("teach")).toBe("technical");
    expect(deriveDiagnosticsAudience("report")).toBe("technical");
    expect(deriveDiagnosticsAudience("intake")).toBe("front_office");
    expect(deriveDiagnosticsAudience("advisor")).toBe("front_office");
  });

  it("enforces assigned-WO access for floor roles and rejects the kiosk", () => {
    expect(() =>
      assertDiagnosticsAccess(actor("technician"), scope(), "shop", "read")
    ).not.toThrow();
    expect(() =>
      assertDiagnosticsAccess(
        actor("technician"),
        scope({ primaryTechnicianId: null, jobs: [] }),
        "shop",
        "read"
      )
    ).toThrow("FORBIDDEN");
    expect(() =>
      assertDiagnosticsAccess(actor("time_clock_kiosk"), scope(), "shop", "read")
    ).toThrow("FORBIDDEN");
  });

  it("requires client and pricing permissions for front-office modes", () => {
    expect(() =>
      assertDiagnosticsAccess(actor("technician"), scope(), "advisor", "read")
    ).toThrow("FORBIDDEN");
    expect(() =>
      assertDiagnosticsAccess(actor("service_advisor"), scope(), "advisor", "read")
    ).not.toThrow();
  });

  it.each([
    ["owner", "shop", true],
    ["owner", "advisor", true],
    ["manager", "shop", true],
    ["manager", "advisor", true],
    ["service_advisor", "shop", true],
    ["service_advisor", "advisor", true],
    ["admin", "shop", true],
    ["admin", "advisor", true],
    ["technician", "shop", true],
    ["technician", "advisor", false],
    ["head_tech", "shop", true],
    ["head_tech", "advisor", false],
    ["time_clock_kiosk", "shop", false],
    ["time_clock_kiosk", "advisor", false],
  ] as const)("authorizes role=%s mode=%s expected=%s", (role, mode, expected) => {
    const check = () => assertDiagnosticsAccess(actor(role), scope(), mode, "read");
    if (expected) expect(check).not.toThrow();
    else expect(check).toThrow("FORBIDDEN");
  });

  it("allows a member to read a foreign-location WO but denies mutations", () => {
    const foreignLocation = "61111111-1111-4111-8111-111111111111";
    const advisor = actor("service_advisor", {
      location_ids: ["31111111-1111-4111-8111-111111111111", foreignLocation],
    });
    const foreignScope = scope({ locationId: foreignLocation });

    expect(() =>
      assertDiagnosticsAccess(advisor, foreignScope, "advisor", "read")
    ).not.toThrow();
    expect(() =>
      assertDiagnosticsAccess(advisor, foreignScope, "advisor", "write")
    ).toThrow("FOREIGN_LOCATION");
  });

  it.each(["technician", "head_tech"] as const)(
    "rejects a %s writing a colleague's job-scoped thread",
    (role) => {
      const user = actor(role);
      const ownJobId = "51111111-1111-4111-8111-111111111111";
      const colleagueJobId = "52222222-2222-4222-8222-222222222222";
      const workOrder = scope({
        primaryTechnicianId: null,
        jobs: [
          { jobId: ownJobId, assignedTechnicianId: user.user_id },
          {
            jobId: colleagueJobId,
            assignedTechnicianId: "91111111-1111-4111-8111-111111111111",
          },
        ],
      });

      expect(() =>
        assertDiagnosticsThreadWrite(user, workOrder, {
          threadId: "71111111-1111-4111-8111-111111111111",
          workOrderId: workOrder.workOrderId,
          jobId: colleagueJobId,
          locationId: workOrder.locationId,
          mode: "shop",
          audience: "technical",
          status: "ready",
          diagnosticPhase: null,
          triggerType: null,
          createdAt: "2026-09-29T00:00:00.000Z",
          updatedAt: "2026-09-29T00:00:00.000Z",
        })
      ).toThrow("FORBIDDEN");
    }
  );

  it("keeps the documented head-tech safety-stage work-order exception", () => {
    const user = actor("head_tech");
    const colleagueJobId = "52222222-2222-4222-8222-222222222222";
    const workOrder = scope({
      status: "safety_check",
      primaryTechnicianId: null,
      qualityCheckAssignedTo: null,
      jobs: [
        {
          jobId: colleagueJobId,
          assignedTechnicianId: "91111111-1111-4111-8111-111111111111",
        },
      ],
    });

    expect(() =>
      assertDiagnosticsThreadWrite(user, workOrder, {
        threadId: "71111111-1111-4111-8111-111111111111",
        workOrderId: workOrder.workOrderId,
        jobId: colleagueJobId,
        locationId: workOrder.locationId,
        mode: "shop",
        audience: "technical",
        status: "ready",
        diagnosticPhase: null,
        triggerType: null,
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      })
    ).not.toThrow();
  });
});

function repository(): DiagnosticsAssistantRepository {
  return {
    loadWorkOrderScope: vi.fn().mockResolvedValue(scope()),
    listThreads: vi.fn().mockResolvedValue([]),
    loadThread: vi.fn(),
    createThread: vi.fn(),
    findTriggerThread: vi.fn(),
    loadJob: vi.fn().mockResolvedValue({
      jobId: "51111111-1111-4111-8111-111111111111",
      workOrderId: scope().workOrderId,
    }),
    triggerEntityBelongsToWorkOrder: vi.fn().mockResolvedValue(true),
    isActiveUserAtLocation: vi.fn().mockResolvedValue(true),
    beginTurn: vi.fn(),
    beginSeedTurn: vi.fn(),
    loadGenerationInput: vi.fn(),
    completeGeneration: vi.fn(),
    failGeneration: vi.fn(),
    claimLatestRetry: vi.fn(),
    loadContextSource: vi.fn(),
    loadPhotoRows: vi.fn(),
    downloadPhoto: vi.fn(),
    loadLatestSuccessfulModel: vi.fn().mockResolvedValue({
      requestedModel: "model-alias",
      resolvedModel: "model-resolved-1",
    }),
    listPromotedNoteIds: vi.fn().mockResolvedValue(new Map()),
  };
}

describe("Ask OTOMOTO service boundaries", () => {
  it("requires authentication on every public read", async () => {
    const repo = repository();
    const requireUser = vi.fn().mockRejectedValue(new Error("UNAUTHORIZED"));
    const service = createDiagnosticsAssistantService({ repository: repo, requireUser });

    await expect(service.listThreads(scope().workOrderId)).rejects.toThrow(
      "UNAUTHORIZED"
    );
    expect(repo.loadWorkOrderScope).not.toHaveBeenCalled();
  });

  it("rejects cross-WO thread IDs without an unscoped lookup", async () => {
    const repo = repository();
    vi.mocked(repo.loadThread).mockResolvedValue(null);
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("service_advisor"),
    });

    await expect(
      service.loadThread(scope().workOrderId, "71111111-1111-4111-8111-111111111111")
    ).rejects.toThrow("ASK_OTOMOTO_THREAD_NOT_FOUND");
    expect(repo.loadThread).toHaveBeenCalledWith(
      scope().workOrderId,
      "71111111-1111-4111-8111-111111111111"
    );
  });

  it("marks ready assistant messages that were already promoted to a note", async () => {
    const repo = repository();
    const threadId = "71111111-1111-4111-8111-111111111111";
    const message = (
      messageId: string,
      role: "user" | "assistant",
      generationStatus: "ready" | "failed"
    ) => ({
      messageId,
      threadId,
      role,
      body: "Body",
      generationStatus,
      requestedInput: null,
      phase: null,
      safeErrorCode: null,
      parentUserMessageId: null,
      requestedProviderModel: null,
      providerModel: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
      photos: [],
    });
    const promoted = "a1111111-1111-4111-8111-111111111111";
    const fresh = "a2222222-2222-4222-8222-222222222222";
    const failed = "a3333333-3333-4333-8333-333333333333";
    const user = "b1111111-1111-4111-8111-111111111111";
    vi.mocked(repo.loadThread).mockResolvedValue({
      thread: {
        threadId,
        workOrderId: scope().workOrderId,
        jobId: null,
        locationId: scope().locationId,
        mode: "shop",
        audience: "technical",
        status: "ready",
        diagnosticPhase: null,
        triggerType: null,
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      },
      messages: [
        message(user, "user", "ready"),
        message(promoted, "assistant", "ready"),
        message(fresh, "assistant", "ready"),
        message(failed, "assistant", "failed"),
      ],
    });
    vi.mocked(repo.listPromotedNoteIds).mockResolvedValue(
      new Map([[promoted, "c1111111-1111-4111-8111-111111111111"]])
    );
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
    });

    const workspace = await service.loadThread(scope().workOrderId, threadId);

    expect(repo.listPromotedNoteIds).toHaveBeenCalledWith(scope().workOrderId, [
      promoted,
      fresh,
    ]);
    expect(
      workspace.messages.map((item) => [item.messageId, item.promotedNoteId])
    ).toEqual([
      [user, null],
      [promoted, "c1111111-1111-4111-8111-111111111111"],
      [fresh, null],
      [failed, null],
    ]);
  });

  it("keeps an authorized thread readable when the promotion lookup fails", async () => {
    const repo = repository();
    const threadId = "71111111-1111-4111-8111-111111111111";
    const messageId = "a1111111-1111-4111-8111-111111111111";
    vi.mocked(repo.loadThread).mockResolvedValue({
      thread: {
        threadId,
        workOrderId: scope().workOrderId,
        jobId: null,
        locationId: scope().locationId,
        mode: "shop",
        audience: "technical",
        status: "ready",
        diagnosticPhase: null,
        triggerType: null,
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      },
      messages: [
        {
          messageId,
          threadId,
          role: "assistant",
          body: "Check the fuse",
          generationStatus: "ready",
          requestedInput: null,
          phase: null,
          safeErrorCode: null,
          parentUserMessageId: null,
          requestedProviderModel: null,
          providerModel: null,
          createdAt: "2026-09-29T00:00:00.000Z",
          updatedAt: "2026-09-29T00:00:00.000Z",
          photos: [],
        },
      ],
    });
    vi.mocked(repo.listPromotedNoteIds).mockRejectedValue(
      new Error("permission denied for note by Jane Doe 647-555-0100")
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
    });

    try {
      const workspace = await service.loadThread(scope().workOrderId, threadId);

      expect(workspace.messages).toHaveLength(1);
      expect(workspace.messages[0]).toMatchObject({
        messageId,
        body: "Check the fuse",
        promotedNoteId: null,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain(threadId);
      expect(logged).not.toMatch(/Jane|647|permission denied/);
    } finally {
      warn.mockRestore();
    }
  });

  it("still rejects unauthorized reads before any promotion lookup", async () => {
    const repo = repository();
    vi.mocked(repo.loadThread).mockResolvedValue(null);
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
    });
    await expect(
      service.loadThread(scope().workOrderId, "71111111-1111-4111-8111-111111111111")
    ).rejects.toThrow("ASK_OTOMOTO_THREAD_NOT_FOUND");
    expect(repo.listPromotedNoteIds).not.toHaveBeenCalled();
  });

  it("skips the promotion lookup when no assistant message is ready", async () => {
    const repo = repository();
    vi.mocked(repo.loadThread).mockResolvedValue({
      thread: {
        threadId: "71111111-1111-4111-8111-111111111111",
        workOrderId: scope().workOrderId,
        jobId: null,
        locationId: scope().locationId,
        mode: "shop",
        audience: "technical",
        status: "pending",
        diagnosticPhase: null,
        triggerType: null,
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      },
      messages: [],
    });
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
    });
    await service.loadThread(scope().workOrderId, "71111111-1111-4111-8111-111111111111");
    expect(repo.listPromotedNoteIds).not.toHaveBeenCalled();
  });

  it("rejects a selected job outside the WO before creating a thread", async () => {
    const repo = repository();
    vi.mocked(repo.loadJob).mockResolvedValue(null);
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("service_advisor"),
    });

    await expect(
      service.createThread({
        workOrderId: scope().workOrderId,
        jobId: "81111111-1111-4111-8111-111111111111",
        mode: "advisor",
      })
    ).rejects.toThrow("JOB_NOT_FOUND");
    expect(repo.createThread).not.toHaveBeenCalled();
  });

  it("derives location and audience server-side when creating", async () => {
    const repo = repository();
    vi.mocked(repo.createThread).mockImplementation(async (input) => ({
      threadId: "71111111-1111-4111-8111-111111111111",
      workOrderId: input.workOrderId,
      jobId: input.jobId,
      locationId: input.locationId,
      mode: input.mode,
      audience: input.audience,
      status: "pending",
      diagnosticPhase: null,
      triggerType: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    }));
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("service_advisor"),
    });

    await service.createThread({
      workOrderId: scope().workOrderId,
      jobId: "51111111-1111-4111-8111-111111111111",
      mode: "advisor",
    });

    expect(repo.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "front_office",
        locationId: scope().locationId,
        createdByUserId: actor("service_advisor").user_id,
      })
    );
  });

  it("shapes owner preview reads through the trusted subject role", async () => {
    const repo = repository();
    vi.mocked(repo.listThreads).mockResolvedValue([
      {
        threadId: "71111111-1111-4111-8111-111111111111",
        workOrderId: scope().workOrderId,
        jobId: null,
        locationId: scope().locationId,
        mode: "advisor",
        audience: "front_office",
        status: "ready",
        diagnosticPhase: null,
        triggerType: null,
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      },
    ]);
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("owner"),
    });

    await expect(
      service.listThreads(scope().workOrderId, {
        role: "technician",
        subjectUserId: actor("technician").user_id,
      })
    ).resolves.toEqual([]);
  });

  it("denies thread writes at a non-current shop for floor staff", async () => {
    const repo = repository();
    const foreignLocation = "61111111-1111-4111-8111-111111111111";
    vi.mocked(repo.loadWorkOrderScope).mockResolvedValue(
      scope({ locationId: foreignLocation })
    );
    vi.mocked(repo.loadThread).mockResolvedValue({
      thread: {
        threadId: "71111111-1111-4111-8111-111111111111",
        workOrderId: scope().workOrderId,
        jobId: "51111111-1111-4111-8111-111111111111",
        locationId: foreignLocation,
        mode: "shop",
        audience: "technical",
        status: "ready",
        diagnosticPhase: null,
        triggerType: null,
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      },
      messages: [],
    });
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () =>
        actor("technician", {
          location_ids: [scope().locationId, foreignLocation],
        }),
    });

    await expect(
      service.authorizeThreadWrite(
        scope().workOrderId,
        "71111111-1111-4111-8111-111111111111"
      )
    ).rejects.toThrow("FOREIGN_LOCATION");
  });

  it("exposes server-computed stale and automatic recovery deadlines", async () => {
    const repo = repository();
    const base = {
      threadId: "71111111-1111-4111-8111-111111111111",
      workOrderId: scope().workOrderId,
      jobId: null,
      locationId: scope().locationId,
      mode: "shop" as const,
      audience: "technical" as const,
      diagnosticPhase: null,
      triggerEntityId: "e1111111-1111-4111-8111-111111111111",
      createdByUserId: actor("technician").user_id,
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    };
    vi.mocked(repo.listThreads).mockResolvedValue([
      { ...base, status: "generating", triggerType: null },
      {
        ...base,
        threadId: "72222222-2222-4222-8222-222222222222",
        status: "pending",
        triggerType: "inspection_completed",
      },
    ]);
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      providerTimeoutMs: 120_000,
    });

    const threads = await service.listThreads(scope().workOrderId);

    expect(threads[0]).toMatchObject({
      retryableAt: "2026-09-29T00:04:30.000Z",
      automaticRecoveryAt: null,
    });
    expect(threads[1]).toMatchObject({
      retryableAt: null,
      automaticRecoveryAt: "2026-09-29T00:00:30.000Z",
    });
  });

  it("re-authorizes an aged empty automatic thread and returns the exact internal seed", async () => {
    const repo = repository();
    const assertConfigured = vi.fn();
    vi.mocked(repo.loadThread).mockResolvedValue({
      thread: {
        threadId: "71111111-1111-4111-8111-111111111111",
        workOrderId: scope().workOrderId,
        jobId: "51111111-1111-4111-8111-111111111111",
        locationId: scope().locationId,
        mode: "shop",
        audience: "technical",
        status: "pending",
        diagnosticPhase: null,
        triggerType: "job_completed",
        triggerEntityId: "51111111-1111-4111-8111-111111111111",
        createdByUserId: actor("technician").user_id,
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      },
      messages: [],
    });
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      now: () => new Date("2026-09-29T00:00:31.000Z"),
      assertConfigured,
    });

    await expect(
      service.authorizeAutomaticTriggerRecovery({
        workOrderId: scope().workOrderId,
        threadId: "71111111-1111-4111-8111-111111111111",
      })
    ).resolves.toEqual({
      actor: {
        userId: actor("technician").user_id,
        locationId: scope().locationId,
      },
      trigger: {
        workOrderId: scope().workOrderId,
        threadId: "71111111-1111-4111-8111-111111111111",
        jobId: "51111111-1111-4111-8111-111111111111",
        trigger: "job_completion",
        triggerEntityId: "51111111-1111-4111-8111-111111111111",
      },
    });
    expect(assertConfigured).toHaveBeenCalledOnce();
    expect(repo.triggerEntityBelongsToWorkOrder).toHaveBeenCalledWith(
      scope().workOrderId,
      "job_completed",
      "51111111-1111-4111-8111-111111111111"
    );
    expect(repo.beginSeedTurn).not.toHaveBeenCalled();
  });

  it.each([
    ["grace", {}, [], "2026-09-29T00:00:29.999Z", "ASK_OTOMOTO_RECOVERY_NOT_READY"],
    [
      "messages",
      {},
      [{ messageId: "existing" }],
      "2026-09-29T00:00:31.000Z",
      "ASK_OTOMOTO_RECOVERY_NOT_FOUND",
    ],
    [
      "read-only work order",
      { workOrderStatus: "completed" },
      [],
      "2026-09-29T00:00:31.000Z",
      "WORK_ORDER_LOCKED",
    ],
    [
      "foreign location",
      { foreign: true },
      [],
      "2026-09-29T00:00:31.000Z",
      "FOREIGN_LOCATION",
    ],
  ])(
    "rejects automatic recovery under the %s lock",
    async (_name, options, messages, nowIso, code) => {
      const repo = repository();
      const foreignLocation = "61111111-1111-4111-8111-111111111111";
      if ("workOrderStatus" in options) {
        vi.mocked(repo.loadWorkOrderScope).mockResolvedValue(
          scope({ status: String(options.workOrderStatus) })
        );
      }
      if ("foreign" in options) {
        vi.mocked(repo.loadWorkOrderScope).mockResolvedValue(
          scope({ locationId: foreignLocation })
        );
      }
      vi.mocked(repo.loadThread).mockResolvedValue({
        thread: {
          threadId: "71111111-1111-4111-8111-111111111111",
          workOrderId: scope().workOrderId,
          jobId: null,
          locationId: "foreign" in options ? foreignLocation : scope().locationId,
          mode: "shop",
          audience: "technical",
          status: "pending",
          diagnosticPhase: null,
          triggerType: "inspection_completed",
          triggerEntityId: "e1111111-1111-4111-8111-111111111111",
          createdByUserId: actor("technician").user_id,
          createdAt: "2026-09-29T00:00:00.000Z",
          updatedAt: "2026-09-29T00:00:00.000Z",
        },
        messages: messages as never,
      });
      const service = createDiagnosticsAssistantService({
        repository: repo,
        requireUser: async () =>
          actor("technician", {
            location_ids:
              "foreign" in options
                ? [scope().locationId, foreignLocation]
                : [scope().locationId],
          }),
        now: () => new Date(nowIso),
        assertConfigured: vi.fn(),
      });

      await expect(
        service.authorizeAutomaticTriggerRecovery({
          workOrderId: scope().workOrderId,
          threadId: "71111111-1111-4111-8111-111111111111",
        })
      ).rejects.toThrow(code);
      expect(repo.beginSeedTurn).not.toHaveBeenCalled();
    }
  );

  it("does not schedule automatic recovery when provider configuration is locked", async () => {
    const repo = repository();
    vi.mocked(repo.loadThread).mockResolvedValue({
      thread: {
        threadId: "71111111-1111-4111-8111-111111111111",
        workOrderId: scope().workOrderId,
        jobId: null,
        locationId: scope().locationId,
        mode: "shop",
        audience: "technical",
        status: "pending",
        diagnosticPhase: null,
        triggerType: "inspection_completed",
        triggerEntityId: "e1111111-1111-4111-8111-111111111111",
        createdByUserId: actor("technician").user_id,
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      },
      messages: [],
    });
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      now: () => new Date("2026-09-29T00:00:31.000Z"),
      assertConfigured: () => {
        throw new Error("DIAGNOSTICS_AI_NOT_CONFIGURED");
      },
    });

    await expect(
      service.authorizeAutomaticTriggerRecovery({
        workOrderId: scope().workOrderId,
        threadId: "71111111-1111-4111-8111-111111111111",
      })
    ).rejects.toThrow("DIAGNOSTICS_AI_NOT_CONFIGURED");
    expect(repo.beginSeedTurn).not.toHaveBeenCalled();
  });
});

const contextSource = (): DiagnosticsContextSource => ({
  workOrder: {
    workOrderId: scope().workOrderId,
    workOrderNumber: "WO-100",
    status: "in_progress",
    complaint: "Alex Rider reports a no-start",
    internalNotes: "Call alex@example.invalid at 123 Customer Street",
  },
  motorcycle: {
    year: 2024,
    make: "Honda",
    model: "CB500F",
    vin: "SECRET-VIN-123",
    notes: "Customer Alex Rider",
  },
  jobs: [
    {
      jobId: "51111111-1111-4111-8111-111111111111",
      workOrderId: scope().workOrderId,
      origin: "customer_request",
      serviceName: "Diagnosis",
      status: "in_progress",
      prices: { currency: "CAD", totalCents: 12345 },
      authorization: {
        decision: "approved",
        decidedAt: "2026-09-29T00:00:00.000Z",
      },
      parts: [],
      checklist: [],
      verification: [],
    },
  ],
  technicianNotes: [],
  recommendations: [],
  checks: { quality: [], safety: [] },
});

const generationResult = (): DiagnosticsGenerationResult => ({
  response: {
    phase: "information_needed",
    review_status: "staff_review_required",
    answer: "A measurement is needed.",
    assessments: [],
    requested_input: {
      type: "measurement",
      prompt: "Measure battery voltage.",
      purpose: "Check supply.",
      tool_placement: "Across battery posts.",
      conditions: "Bike secured.",
      units: "V DC",
    },
    next_step: "Measure battery voltage.",
    safety: { stop_work: false, do_not_ride: false, boundary: null },
    sources: [],
    source_summary: "No exact-model source supplied.",
    limitations: ["No physical test performed."],
    shop_log_entry: null,
  },
  responseId: "response-1",
  requestedModel: "model-alias",
  resolvedModel: "model-resolved-2",
  promptVersion: "prompt-v1",
  contextHash: "a".repeat(64),
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
});

function generationRepository() {
  const repo = repository();
  const thread = {
    threadId: "71111111-1111-4111-8111-111111111111",
    workOrderId: scope().workOrderId,
    jobId: "51111111-1111-4111-8111-111111111111",
    locationId: scope().locationId,
    mode: "shop" as const,
    audience: "technical" as const,
    status: "ready" as const,
    diagnosticPhase: null,
    triggerType: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
  const previous = {
    messageId: "91111111-1111-4111-8111-111111111111",
    threadId: thread.threadId,
    role: "assistant" as const,
    body: "Prior answer",
    generationStatus: "ready" as const,
    requestedInput: null,
    phase: "diagnosis" as const,
    safeErrorCode: null,
    parentUserMessageId: null,
    requestedProviderModel: "model-alias",
    providerModel: "model-resolved-1",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    photos: [],
  };
  const generated = {
    ...previous,
    messageId: "a1111111-1111-4111-8111-111111111111",
    body: "Generated answer",
    parentUserMessageId: "b1111111-1111-4111-8111-111111111111",
    providerModel: "model-resolved-2",
  };
  vi.mocked(repo.loadThread).mockResolvedValue({
    thread,
    messages: [previous, generated],
  });
  vi.mocked(repo.loadPhotoRows).mockResolvedValue([]);
  vi.mocked(repo.beginTurn).mockResolvedValue({
    userMessageId: "b1111111-1111-4111-8111-111111111111",
    assistantMessageId: generated.messageId,
    attemptId: "attempt-1",
  });
  vi.mocked(repo.loadGenerationInput).mockResolvedValue({
    userMessageId: "b1111111-1111-4111-8111-111111111111",
    assistantMessageId: generated.messageId,
    userMessage: "Help diagnose it",
    photos: [],
    history: [],
  });
  vi.mocked(repo.loadContextSource).mockResolvedValue({
    source: contextSource(),
    redactTerms: {
      customerName: "Alex Rider",
      email: "alex@example.invalid",
      fullVin: "SECRET-VIN-123",
      address: "123 Customer Street",
    },
  });
  return { repo, thread, generated };
}

describe("Ask OTOMOTO generation lifecycle", () => {
  it("rejects cross-job photos before persisting a turn", async () => {
    const { repo, thread } = generationRepository();
    vi.mocked(repo.loadPhotoRows).mockResolvedValue([
      {
        photoId: "c1111111-1111-4111-8111-111111111111",
        workOrderId: scope().workOrderId,
        jobId: "d1111111-1111-4111-8111-111111111111",
        category: "job_work",
        storagePath: "private/photo.jpg",
      },
    ]);
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
    });

    await expect(
      service.submitTurn({
        workOrderId: scope().workOrderId,
        threadId: thread.threadId,
        jobId: thread.jobId,
        mode: "shop",
        text: "Help diagnose it",
        photos: [
          {
            photoId: "c1111111-1111-4111-8111-111111111111",
            purpose: "Inspect terminal",
          },
        ],
      })
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_JOB_MISMATCH");
    expect(repo.beginTurn).not.toHaveBeenCalled();
  });

  it("rejects cross-WO photos through the scoped lookup", async () => {
    const { repo, thread } = generationRepository();
    vi.mocked(repo.loadPhotoRows).mockResolvedValue([]);
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await expect(
      service.submitTurn({
        workOrderId: scope().workOrderId,
        threadId: thread.threadId,
        jobId: thread.jobId,
        mode: "shop",
        text: "Help diagnose it",
        photos: [
          {
            photoId: "c1111111-1111-4111-8111-111111111111",
            purpose: "Inspect terminal",
          },
        ],
      })
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_NOT_FOUND");
    expect(repo.beginTurn).not.toHaveBeenCalled();
  });

  it("redacts PII and omits pricing from technical provider context", async () => {
    const { repo, thread } = generationRepository();
    const generateDraft = vi
      .fn<
        (request: DiagnosticsGenerationRequest) => Promise<DiagnosticsGenerationResult>
      >()
      .mockResolvedValue(generationResult());
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft,
      prepareImages: async () => ({ images: [], photoMetadata: [] }),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
      now: () => new Date("2026-09-29T01:00:00.000Z"),
    });

    await service.submitTurn({
      workOrderId: scope().workOrderId,
      threadId: thread.threadId,
      jobId: thread.jobId,
      mode: "shop",
      text: "Help diagnose it",
      photos: [],
    });

    const serialized = JSON.stringify(generateDraft.mock.calls[0]![0].workOrderContext);
    expect(serialized).not.toContain("Alex Rider");
    expect(serialized).not.toContain("alex@example.invalid");
    expect(serialized).not.toContain("123 Customer Street");
    expect(serialized).not.toContain("SECRET-VIN-123");
    expect(serialized).not.toContain("12345");
    expect(serialized).not.toContain("authorization");
    expect(repo.completeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "information_needed",
        requestedInput: generationResult().response.requested_input,
        contextAsOf: "2026-09-29T01:00:00.000Z",
      })
    );
  });

  it("redacts the current request, history, and photo purposes before provider use", async () => {
    const { repo, thread } = generationRepository();
    vi.mocked(repo.loadPhotoRows).mockResolvedValue([
      {
        photoId: "c1111111-1111-4111-8111-111111111111",
        workOrderId: scope().workOrderId,
        jobId: thread.jobId,
        category: "job_work",
        storagePath: "private/photo.jpg",
      },
    ]);
    vi.mocked(repo.loadGenerationInput).mockResolvedValue({
      userMessageId: "b1111111-1111-4111-8111-111111111111",
      assistantMessageId: "a1111111-1111-4111-8111-111111111111",
      userMessage:
        "Alex Rider at 123 Customer Street: call 647-555-1234, alex@example.invalid, VIN SECRET-VIN-123",
      photos: [
        {
          photoId: "c1111111-1111-4111-8111-111111111111",
          purpose: "Alex Rider's VIN SECRET-VIN-123",
        },
      ],
      history: [
        {
          role: "user",
          content: "Prior note from Alex Rider, 647-555-1234",
        },
      ],
    });
    vi.mocked(repo.loadContextSource).mockResolvedValue({
      source: contextSource(),
      redactTerms: {
        customerName: "Alex Rider",
        email: "alex@example.invalid",
        phone: "647-555-1234",
        address: "123 Customer Street",
        fullVin: "SECRET-VIN-123",
      },
    });
    const generateDraft = vi
      .fn<
        (request: DiagnosticsGenerationRequest) => Promise<DiagnosticsGenerationResult>
      >()
      .mockResolvedValue(generationResult());
    const prepareImages = vi.fn(
      async (input: { selections: Array<{ photoId: string; purpose: string }> }) => ({
        images: input.selections.map((selection) => ({
          photoId: selection.photoId,
          purpose: selection.purpose,
          dataUrl: "data:image/jpeg;base64,YQ==",
        })),
        photoMetadata: [],
      })
    );
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft,
      prepareImages,
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await service.submitTurn({
      workOrderId: scope().workOrderId,
      threadId: thread.threadId,
      jobId: thread.jobId,
      mode: "shop",
      text: "Original text remains persisted",
      photos: [
        {
          photoId: "c1111111-1111-4111-8111-111111111111",
          purpose: "Original purpose remains persisted",
        },
      ],
    });

    const providerPayload = JSON.stringify(generateDraft.mock.calls[0]![0]);
    for (const pii of [
      "Alex Rider",
      "123 Customer Street",
      "647-555-1234",
      "alex@example.invalid",
      "SECRET-VIN-123",
    ]) {
      expect(providerPayload).not.toContain(pii);
    }
    expect(repo.beginTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Original text remains persisted",
        photos: [
          expect.objectContaining({ purpose: "Original purpose remains persisted" }),
        ],
      })
    );
    expect(repo.loadGenerationInput).toHaveBeenCalledWith(
      scope().workOrderId,
      thread.threadId,
      "b1111111-1111-4111-8111-111111111111",
      "a1111111-1111-4111-8111-111111111111"
    );
  });

  it("persists a safe failed state for provider and missing-config errors", async () => {
    for (const code of [
      "DIAGNOSTICS_AI_PROVIDER_UNAVAILABLE",
      "DIAGNOSTICS_AI_NOT_CONFIGURED",
    ]) {
      const { repo, thread, generated } = generationRepository();
      const service = createDiagnosticsAssistantService({
        repository: repo,
        requireUser: async () => actor("technician"),
        generateDraft: async () => {
          throw new Error(code);
        },
        prepareImages: async () => ({ images: [], photoMetadata: [] }),
        consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
      });

      await expect(
        service.submitTurn({
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          jobId: thread.jobId,
          mode: "shop",
          text: "Help diagnose it",
          photos: [],
        })
      ).rejects.toThrow(code);
      expect(repo.failGeneration).toHaveBeenCalledWith({
        threadId: thread.threadId,
        assistantMessageId: generated.messageId,
        attemptId: "attempt-1",
        safeErrorCode: code,
      });
    }
  });

  it("maps database transport failures to a generic lifecycle code", async () => {
    const { repo, thread, generated } = generationRepository();
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft: async () => {
        throw new Error("PGRST116");
      },
      prepareImages: async () => ({ images: [], photoMetadata: [] }),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await expect(
      service.submitTurn({
        workOrderId: scope().workOrderId,
        threadId: thread.threadId,
        jobId: thread.jobId,
        mode: "shop",
        text: "Help diagnose it",
        photos: [],
      })
    ).rejects.toThrow("ASK_OTOMOTO_LIFECYCLE_FAILED");
    expect(repo.failGeneration).toHaveBeenCalledWith({
      threadId: thread.threadId,
      assistantMessageId: generated.messageId,
      attemptId: "attempt-1",
      safeErrorCode: "ASK_OTOMOTO_LIFECYCLE_FAILED",
    });
  });

  it("fails the claimed turn when its explicit generation input cannot reload", async () => {
    const { repo, thread, generated } = generationRepository();
    vi.mocked(repo.loadGenerationInput).mockRejectedValue(new Error("PGRST116"));
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await expect(
      service.submitTurn({
        workOrderId: scope().workOrderId,
        threadId: thread.threadId,
        jobId: thread.jobId,
        mode: "shop",
        text: "Help diagnose it",
        photos: [],
      })
    ).rejects.toThrow("ASK_OTOMOTO_LIFECYCLE_FAILED");
    expect(repo.failGeneration).toHaveBeenCalledWith({
      threadId: thread.threadId,
      assistantMessageId: generated.messageId,
      attemptId: "attempt-1",
      safeErrorCode: "ASK_OTOMOTO_LIFECYCLE_FAILED",
    });
  });

  it("retries the existing failed assistant without creating another user message", async () => {
    const { repo, thread, generated } = generationRepository();
    vi.mocked(repo.claimLatestRetry).mockResolvedValue({
      userMessageId: "b1111111-1111-4111-8111-111111111111",
      assistantMessageId: generated.messageId,
      attemptId: "attempt-2",
    });
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft: async () => generationResult(),
      prepareImages: async () => ({ images: [], photoMetadata: [] }),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
      providerTimeoutMs: 120_000,
    });

    await service.retryLatestFailed({
      workOrderId: scope().workOrderId,
      threadId: thread.threadId,
    });

    expect(repo.beginTurn).not.toHaveBeenCalled();
    expect(repo.claimLatestRetry).toHaveBeenCalledWith(
      scope().workOrderId,
      thread.threadId,
      270_000
    );
    expect(repo.completeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId: generated.messageId,
        attemptId: "attempt-2",
      })
    );
  });

  it("allows a normal retest follow-up in a job-completion thread to enter verification", async () => {
    const { repo, thread, generated } = generationRepository();
    const triggerThread = {
      ...thread,
      triggerType: "job_completed" as const,
      triggerEntityId: thread.jobId,
      createdByUserId: actor("technician").user_id,
    };
    vi.mocked(repo.loadThread).mockResolvedValue({
      thread: triggerThread,
      messages: [generated],
    });
    vi.mocked(repo.loadGenerationInput).mockResolvedValue({
      userMessageId: generated.parentUserMessageId!,
      assistantMessageId: generated.messageId,
      userMessage: "Comparable retest passed under the original conditions.",
      photos: [],
      history: [
        { role: "user", content: JOB_COMPLETION_SEED_REQUEST },
        { role: "assistant", content: "Repair performed; verification pending." },
      ],
    });
    const source = contextSource();
    source.jobs[0] = {
      ...source.jobs[0]!,
      status: "completed",
      completedAt: "2026-09-29T00:30:00.000Z",
      verification: [
        {
          verificationId: "verification-1",
          result: "passed",
          notes: "Comparable retest passed under the original conditions.",
          recordedAt: "2026-09-29T01:00:00.000Z",
        },
      ],
    };
    vi.mocked(repo.loadContextSource).mockResolvedValue({
      source,
      redactTerms: {},
    });
    const verificationResult: DiagnosticsGenerationResult = {
      ...generationResult(),
      response: {
        ...generationResult().response,
        phase: "verification",
        answer: "The stored comparable retest records successful verification.",
      },
    };
    const generateDraft = vi
      .fn()
      .mockImplementation(async (request: DiagnosticsGenerationRequest) => {
        if (request.requiredPhase) {
          throw new Error("DIAGNOSTICS_AI_OUTPUT_WITHHELD");
        }
        return verificationResult;
      });
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft,
      prepareImages: async () => ({ images: [], photoMetadata: [] }),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await expect(
      service.submitTurn({
        workOrderId: scope().workOrderId,
        threadId: triggerThread.threadId,
        jobId: triggerThread.jobId,
        mode: "shop",
        text: "Comparable retest passed under the original conditions.",
        photos: [],
      })
    ).resolves.toBeDefined();

    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ requiredPhase: undefined })
    );
    expect(repo.completeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "verification" })
    );
  });

  it("keeps closure required when retrying the failed automatic job seed", async () => {
    const { repo, thread, generated } = generationRepository();
    const triggerThread = {
      ...thread,
      status: "failed" as const,
      triggerType: "job_completed" as const,
      triggerEntityId: thread.jobId,
      createdByUserId: actor("technician").user_id,
    };
    vi.mocked(repo.loadThread).mockResolvedValue({
      thread: triggerThread,
      messages: [generated],
    });
    vi.mocked(repo.claimLatestRetry).mockResolvedValue({
      userMessageId: generated.parentUserMessageId!,
      assistantMessageId: generated.messageId,
      attemptId: "seed-retry-attempt",
    });
    vi.mocked(repo.loadGenerationInput).mockResolvedValue({
      userMessageId: generated.parentUserMessageId!,
      assistantMessageId: generated.messageId,
      userMessage: JOB_COMPLETION_SEED_REQUEST,
      photos: [],
      history: [],
    });
    const source = contextSource();
    source.jobs[0] = {
      ...source.jobs[0]!,
      status: "completed",
      completedAt: "2026-09-29T00:30:00.000Z",
    };
    vi.mocked(repo.loadContextSource).mockResolvedValue({
      source,
      redactTerms: {},
    });
    const generateDraft = vi.fn().mockResolvedValue(generationResult());
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft,
      prepareImages: async () => ({ images: [], photoMetadata: [] }),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await service.retryLatestFailed({
      workOrderId: scope().workOrderId,
      threadId: triggerThread.threadId,
    });

    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ requiredPhase: "closure_report" })
    );
  });

  it("writes metadata-only audit when the resolved model changes", async () => {
    const { repo, thread } = generationRepository();
    repo.recordModelChangeAudit = vi.fn();
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft: async () => generationResult(),
      prepareImages: async () => ({ images: [], photoMetadata: [] }),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await service.submitTurn({
      workOrderId: scope().workOrderId,
      threadId: thread.threadId,
      jobId: thread.jobId,
      mode: "shop",
      text: "Help diagnose it",
      photos: [],
    });

    expect(repo.recordModelChangeAudit).toHaveBeenCalledWith({
      actorUserId: actor("technician").user_id,
      locationId: scope().locationId,
      messageId: "a1111111-1111-4111-8111-111111111111",
      previousModel: "model-resolved-1",
      requestedModel: "model-alias",
      resolvedModel: "model-resolved-2",
    });
    expect(
      JSON.stringify(vi.mocked(repo.recordModelChangeAudit).mock.calls)
    ).not.toContain("Generated answer");
  });

  it("does not fail or overwrite a completed response when audit logging fails", async () => {
    const { repo, thread } = generationRepository();
    repo.recordModelChangeAudit = vi
      .fn()
      .mockRejectedValue(new Error("raw audit database failure"));
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft: async () => generationResult(),
      prepareImages: async () => ({ images: [], photoMetadata: [] }),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await expect(
      service.submitTurn({
        workOrderId: scope().workOrderId,
        threadId: thread.threadId,
        jobId: thread.jobId,
        mode: "shop",
        text: "Help diagnose it",
        photos: [],
      })
    ).resolves.toMatchObject({
      messageId: "a1111111-1111-4111-8111-111111111111",
    });
    expect(repo.completeGeneration).toHaveBeenCalledOnce();
    expect(repo.failGeneration).not.toHaveBeenCalled();
  });

  it("keeps selected photo metadata when completed-response reload fails", async () => {
    const { repo, thread, generated } = generationRepository();
    const selectedPhoto = {
      photoId: "c1111111-1111-4111-8111-111111111111",
      category: "job_work",
      notes: "Terminal corrosion",
      purpose: "Inspect the battery terminal",
      sortOrder: 0,
      createdAt: "2026-09-29T01:00:00.000Z",
    };
    vi.mocked(repo.loadGenerationInput).mockResolvedValue({
      userMessageId: "b1111111-1111-4111-8111-111111111111",
      assistantMessageId: generated.messageId,
      userMessage: "Help diagnose it",
      photos: [{ photoId: selectedPhoto.photoId, purpose: selectedPhoto.purpose }],
      selectedPhotoMetadata: [selectedPhoto],
      history: [],
    });
    vi.mocked(repo.loadPhotoRows).mockResolvedValue([
      {
        photoId: selectedPhoto.photoId,
        workOrderId: scope().workOrderId,
        jobId: thread.jobId,
        category: selectedPhoto.category,
        storagePath: "private/photo.jpg",
      },
    ]);
    vi.mocked(repo.loadThread).mockResolvedValueOnce({
      thread,
      messages: [],
    });
    vi.mocked(repo.loadThread).mockRejectedValueOnce(new Error("read unavailable"));
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft: async () => generationResult(),
      prepareImages: async () => ({
        images: [],
        photoMetadata: [
          {
            photoId: selectedPhoto.photoId,
            purpose: selectedPhoto.purpose,
            sortOrder: 0,
            limitation: null,
          },
        ],
      }),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await expect(
      service.submitTurn({
        workOrderId: scope().workOrderId,
        threadId: thread.threadId,
        jobId: thread.jobId,
        mode: "shop",
        text: "Help diagnose it",
        photos: [{ photoId: selectedPhoto.photoId, purpose: selectedPhoto.purpose }],
      })
    ).resolves.toMatchObject({
      photos: [selectedPhoto],
    });
  });

  it("rejects disallowed photo categories before the atomic begin", async () => {
    const { repo, thread } = generationRepository();
    vi.mocked(repo.loadPhotoRows).mockResolvedValue([
      {
        photoId: "c1111111-1111-4111-8111-111111111111",
        workOrderId: scope().workOrderId,
        jobId: null,
        category: "front",
        storagePath: "private/photo.jpg",
      },
    ]);
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await expect(
      service.submitTurn({
        workOrderId: scope().workOrderId,
        threadId: thread.threadId,
        jobId: thread.jobId,
        mode: "shop",
        text: "Help diagnose it",
        photos: [
          {
            photoId: "c1111111-1111-4111-8111-111111111111",
            purpose: "Not a diagnostic category",
          },
        ],
      })
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_CATEGORY_NOT_ALLOWED");
    expect(repo.beginTurn).not.toHaveBeenCalled();
  });

  it.each([
    ["completed", "ready"],
    ["cancelled", "ready"],
    ["in_progress", "archived"],
  ] as const)(
    "rejects generation for work-order=%s thread=%s",
    async (workOrderStatus, threadStatus) => {
      const { repo, thread } = generationRepository();
      vi.mocked(repo.loadWorkOrderScope).mockResolvedValue(
        scope({ status: workOrderStatus })
      );
      vi.mocked(repo.loadThread).mockResolvedValue({
        thread: { ...thread, status: threadStatus },
        messages: [],
      });
      const service = createDiagnosticsAssistantService({
        repository: repo,
        requireUser: async () => actor("technician"),
      });

      await expect(
        service.submitTurn({
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          jobId: thread.jobId,
          mode: "shop",
          text: "Must not start",
          photos: [],
        })
      ).rejects.toThrow(
        threadStatus === "archived" ? "ASK_OTOMOTO_THREAD_ARCHIVED" : "WORK_ORDER_LOCKED"
      );
      expect(repo.beginTurn).not.toHaveBeenCalled();
    }
  );
});

describe("Ask OTOMOTO internal trigger primitive", () => {
  it("rejects a trigger entity outside the authorized work order", async () => {
    const repo = repository();
    vi.mocked(repo.triggerEntityBelongsToWorkOrder).mockResolvedValue(false);

    await expect(
      createOrReuseDiagnosticsTriggerThreadInternal(
        actor("service_advisor"),
        {
          workOrderId: scope().workOrderId,
          jobId: null,
          mode: "shop",
          trigger: "inspection_completion",
          triggerEntityId: "e1111111-1111-4111-8111-111111111111",
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_TRIGGER_NOT_FOUND");
    expect(repo.createThread).not.toHaveBeenCalled();
  });

  it("recovers a concurrent unique conflict by loading the scoped trigger", async () => {
    const repo = repository();
    const existing = {
      threadId: "71111111-1111-4111-8111-111111111111",
      workOrderId: scope().workOrderId,
      jobId: "51111111-1111-4111-8111-111111111111",
      locationId: scope().locationId,
      mode: "shop" as const,
      audience: "technical" as const,
      status: "pending" as const,
      diagnosticPhase: null,
      triggerType: "job_completed" as const,
      triggerEntityId: "51111111-1111-4111-8111-111111111111",
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    };
    vi.mocked(repo.findTriggerThread)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    vi.mocked(repo.createThread).mockRejectedValue({ code: "23505" });

    await expect(
      createOrReuseDiagnosticsTriggerThreadInternal(
        actor("service_advisor"),
        {
          workOrderId: scope().workOrderId,
          jobId: "51111111-1111-4111-8111-111111111111",
          mode: "shop",
          trigger: "job_completion",
          triggerEntityId: "51111111-1111-4111-8111-111111111111",
        },
        { repository: repo }
      )
    ).resolves.toEqual(existing);
  });

  it("rejects reuse when the existing trigger thread scope differs", async () => {
    const repo = repository();
    vi.mocked(repo.findTriggerThread).mockResolvedValue({
      threadId: "71111111-1111-4111-8111-111111111111",
      workOrderId: scope().workOrderId,
      jobId: null,
      locationId: scope().locationId,
      mode: "advisor",
      audience: "front_office",
      status: "pending",
      diagnosticPhase: null,
      triggerType: "inspection_completed",
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    });

    await expect(
      createOrReuseDiagnosticsTriggerThreadInternal(
        actor("service_advisor"),
        {
          workOrderId: scope().workOrderId,
          jobId: null,
          mode: "shop",
          trigger: "inspection_completion",
          triggerEntityId: "e1111111-1111-4111-8111-111111111111",
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
  });

  it("rejects reuse when the repository returns a different trigger entity", async () => {
    const repo = repository();
    vi.mocked(repo.findTriggerThread).mockResolvedValue({
      threadId: "71111111-1111-4111-8111-111111111111",
      workOrderId: scope().workOrderId,
      jobId: "51111111-1111-4111-8111-111111111111",
      locationId: scope().locationId,
      mode: "shop",
      audience: "technical",
      status: "pending",
      diagnosticPhase: null,
      triggerType: "job_completed",
      triggerEntityId: "81111111-1111-4111-8111-111111111111",
      createdByUserId: actor("technician").user_id,
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    });

    await expect(
      createOrReuseDiagnosticsTriggerThreadInternal(
        actor("technician"),
        {
          workOrderId: scope().workOrderId,
          jobId: "51111111-1111-4111-8111-111111111111",
          mode: "shop",
          trigger: "job_completion",
          triggerEntityId: "51111111-1111-4111-8111-111111111111",
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
  });

  it("reuses an inspection trigger's stored job when re-entry carries another job", async () => {
    const repo = repository();
    const existing = {
      threadId: "71111111-1111-4111-8111-111111111111",
      workOrderId: scope().workOrderId,
      jobId: "51111111-1111-4111-8111-111111111111",
      locationId: scope().locationId,
      mode: "shop" as const,
      audience: "technical" as const,
      status: "pending" as const,
      diagnosticPhase: null,
      triggerType: "inspection_completed" as const,
      triggerEntityId: "e1111111-1111-4111-8111-111111111111",
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    };
    vi.mocked(repo.findTriggerThread).mockResolvedValue(existing);

    await expect(
      createOrReuseDiagnosticsTriggerThreadInternal(
        actor("service_advisor"),
        {
          workOrderId: scope().workOrderId,
          jobId: "81111111-1111-4111-8111-111111111111",
          mode: "shop",
          trigger: "inspection_completion",
          triggerEntityId: "e1111111-1111-4111-8111-111111111111",
        },
        { repository: repo }
      )
    ).resolves.toEqual(existing);
    expect(repo.loadJob).not.toHaveBeenCalledWith(
      scope().workOrderId,
      "81111111-1111-4111-8111-111111111111"
    );
  });

  it("falls back to a WO-level inspection trigger when the return job is stale", async () => {
    const repo = repository();
    vi.mocked(repo.findTriggerThread).mockResolvedValue(null);
    vi.mocked(repo.loadJob).mockResolvedValue(null);
    vi.mocked(repo.createThread).mockImplementation(async (input) => ({
      threadId: "71111111-1111-4111-8111-111111111111",
      workOrderId: input.workOrderId,
      jobId: input.jobId,
      locationId: input.locationId,
      mode: input.mode,
      audience: input.audience,
      status: "pending",
      diagnosticPhase: null,
      triggerType: input.triggerType ?? null,
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    }));

    await createOrReuseDiagnosticsTriggerThreadInternal(
      actor("service_advisor"),
      {
        workOrderId: scope().workOrderId,
        jobId: "81111111-1111-4111-8111-111111111111",
        mode: "shop",
        trigger: "inspection_completion",
        triggerEntityId: "e1111111-1111-4111-8111-111111111111",
      },
      { repository: repo }
    );

    expect(repo.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: null })
    );
  });

  it("maps trigger creation database failures to a stable public error", async () => {
    const repo = repository();
    vi.mocked(repo.findTriggerThread).mockResolvedValue(null);
    vi.mocked(repo.createThread).mockRejectedValue(
      new Error("duplicate key leaked_private_constraint")
    );

    await expect(
      createOrReuseDiagnosticsTriggerThreadInternal(
        actor("service_advisor"),
        {
          workOrderId: scope().workOrderId,
          jobId: null,
          mode: "shop",
          trigger: "inspection_completion",
          triggerEntityId: "e1111111-1111-4111-8111-111111111111",
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_LIFECYCLE_FAILED");
  });

  it("maps trigger conflict recovery database failures to a stable public error", async () => {
    const repo = repository();
    vi.mocked(repo.findTriggerThread)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("raw recovery query details"));
    vi.mocked(repo.createThread).mockRejectedValue({ code: "23505" });

    await expect(
      createOrReuseDiagnosticsTriggerThreadInternal(
        actor("service_advisor"),
        {
          workOrderId: scope().workOrderId,
          jobId: null,
          mode: "shop",
          trigger: "inspection_completion",
          triggerEntityId: "e1111111-1111-4111-8111-111111111111",
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_LIFECYCLE_FAILED");
  });
});

describe("Ask OTOMOTO internal inspection-completion generation", () => {
  const triggerEntityId = "e1111111-1111-4111-8111-111111111111";
  const triggerThread = () => ({
    threadId: "71111111-1111-4111-8111-111111111111",
    workOrderId: scope().workOrderId,
    jobId: null,
    locationId: scope().locationId,
    mode: "shop" as const,
    audience: "technical" as const,
    status: "pending" as const,
    diagnosticPhase: null,
    triggerType: "inspection_completed" as const,
    triggerEntityId,
    createdByUserId: actor("technician").user_id,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  });

  function triggerRepository() {
    const repo = repository();
    const thread = triggerThread();
    const generated = {
      messageId: "a1111111-1111-4111-8111-111111111111",
      threadId: thread.threadId,
      role: "assistant" as const,
      body: "Generated arrival-inspection review",
      generationStatus: "ready" as const,
      requestedInput: generationResult().response.requested_input,
      phase: generationResult().response.phase,
      safeErrorCode: null,
      parentUserMessageId: "b1111111-1111-4111-8111-111111111111",
      requestedProviderModel: "model-alias",
      providerModel: "model-resolved-2",
      createdAt: "2026-09-29T01:00:00.000Z",
      updatedAt: "2026-09-29T01:00:00.000Z",
      photos: [],
    };
    vi.mocked(repo.loadThread)
      .mockResolvedValueOnce({ thread, messages: [] })
      .mockResolvedValueOnce({
        thread: { ...thread, status: "ready" },
        messages: [generated],
      });
    vi.mocked(repo.beginSeedTurn).mockResolvedValue({
      userMessageId: generated.parentUserMessageId!,
      assistantMessageId: generated.messageId,
      attemptId: "attempt-1",
    });
    vi.mocked(repo.loadGenerationInput).mockResolvedValue({
      userMessageId: generated.parentUserMessageId!,
      assistantMessageId: generated.messageId,
      userMessage: INSPECTION_COMPLETION_SEED_REQUEST,
      photos: [],
      history: [],
    });
    vi.mocked(repo.loadContextSource).mockResolvedValue({
      source: contextSource(),
      redactTerms: {},
    });
    return { repo, thread, generated };
  }

  it("atomically seeds one photo-free inspection review with the required meaning", async () => {
    const { repo, thread } = triggerRepository();
    const generateDraft = vi.fn().mockResolvedValue(generationResult());
    const prepareImages = vi.fn().mockResolvedValue({
      images: [],
      photoMetadata: [],
    });

    await generateDiagnosticsTriggerResponseInternal(
      {
        userId: actor("technician").user_id,
        locationId: scope().locationId,
      },
      {
        workOrderId: scope().workOrderId,
        threadId: thread.threadId,
        trigger: "inspection_completion",
        triggerEntityId,
      },
      { repository: repo, generateDraft, prepareImages }
    );

    expect(INSPECTION_COMPLETION_SEED_REQUEST).toMatch(/reported symptoms/i);
    expect(INSPECTION_COMPLETION_SEED_REQUEST).toMatch(/measured.*observed/i);
    expect(INSPECTION_COMPLETION_SEED_REQUEST).toMatch(/confirmed.*probable.*possible/i);
    expect(INSPECTION_COMPLETION_SEED_REQUEST).toMatch(
      /not-inspected.*not-tested.*incomplete/i
    );
    expect(INSPECTION_COMPLETION_SEED_REQUEST).toMatch(/single highest-value safe/i);
    expect(INSPECTION_COMPLETION_SEED_REQUEST).toMatch(
      /no statutory pass\/fail or roadworthiness/i
    );
    expect(INSPECTION_COMPLETION_SEED_REQUEST).toMatch(/exactly one NEXT STEP/i);
    expect(repo.beginSeedTurn).toHaveBeenCalledWith({
      workOrderId: scope().workOrderId,
      threadId: thread.threadId,
      triggerType: "inspection_completed",
      triggerEntityId,
      userId: actor("technician").user_id,
      text: INSPECTION_COMPLETION_SEED_REQUEST,
    });
    expect(prepareImages).toHaveBeenCalledWith(
      expect.objectContaining({ selections: [] }),
      repo
    );
    expect(generateDraft).toHaveBeenCalledWith(expect.objectContaining({ images: [] }));
  });

  it.each(["ready", "generating"] as const)(
    "returns idempotently when the trigger thread is already %s",
    async (status) => {
      const { repo, thread } = triggerRepository();
      vi.mocked(repo.loadThread)
        .mockReset()
        .mockResolvedValue({
          thread: { ...thread, status },
          messages: [],
        });
      vi.mocked(repo.isActiveUserAtLocation).mockResolvedValue(false);
      const generateDraft = vi.fn();

      await expect(
        generateDiagnosticsTriggerResponseInternal(
          {
            userId: actor("technician").user_id,
            locationId: scope().locationId,
          },
          {
            workOrderId: scope().workOrderId,
            threadId: thread.threadId,
            trigger: "inspection_completion",
            triggerEntityId,
          },
          { repository: repo, generateDraft }
        )
      ).resolves.toBeNull();

      expect(repo.beginSeedTurn).not.toHaveBeenCalled();
      expect(repo.isActiveUserAtLocation).not.toHaveBeenCalled();
      expect(generateDraft).not.toHaveBeenCalled();
    }
  );

  it("leaves an existing failed seed for an explicit Retry", async () => {
    const { repo, thread } = triggerRepository();
    vi.mocked(repo.loadThread)
      .mockReset()
      .mockResolvedValue({
        thread: { ...thread, status: "failed" },
        messages: [],
      });
    vi.mocked(repo.isActiveUserAtLocation).mockResolvedValue(false);
    const generateDraft = vi.fn();

    await expect(
      generateDiagnosticsTriggerResponseInternal(
        {
          userId: actor("technician").user_id,
          locationId: scope().locationId,
        },
        {
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          trigger: "inspection_completion",
          triggerEntityId,
        },
        { repository: repo, generateDraft }
      )
    ).resolves.toBeNull();

    expect(repo.beginSeedTurn).not.toHaveBeenCalled();
    expect(repo.claimLatestRetry).not.toHaveBeenCalled();
    expect(repo.isActiveUserAtLocation).not.toHaveBeenCalled();
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it("reloads and returns idempotently when another callback wins then fails", async () => {
    const { repo, thread } = triggerRepository();
    vi.mocked(repo.loadThread)
      .mockReset()
      .mockResolvedValueOnce({ thread, messages: [] })
      .mockResolvedValueOnce({
        thread: { ...thread, status: "failed" },
        messages: [
          {
            messageId: "a1111111-1111-4111-8111-111111111111",
            threadId: thread.threadId,
            role: "assistant",
            body: null,
            generationStatus: "failed",
            requestedInput: null,
            phase: null,
            safeErrorCode: "DIAGNOSTICS_AI_PROVIDER_UNAVAILABLE",
            parentUserMessageId: "b1111111-1111-4111-8111-111111111111",
            requestedProviderModel: null,
            providerModel: null,
            createdAt: "2026-09-29T00:00:00.000Z",
            updatedAt: "2026-09-29T00:00:00.000Z",
            photos: [],
          },
        ],
      });
    vi.mocked(repo.beginSeedTurn).mockRejectedValue(
      new Error("ASK_OTOMOTO_SEED_ALREADY_CLAIMED")
    );
    const generateDraft = vi.fn();

    await expect(
      generateDiagnosticsTriggerResponseInternal(
        {
          userId: actor("technician").user_id,
          locationId: scope().locationId,
        },
        {
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          trigger: "inspection_completion",
          triggerEntityId,
        },
        { repository: repo, generateDraft }
      )
    ).resolves.toBeNull();

    expect(repo.loadThread).toHaveBeenCalledTimes(2);
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it("normalizes a seed-race reload failure to a stable error", async () => {
    const { repo, thread } = triggerRepository();
    vi.mocked(repo.loadThread)
      .mockReset()
      .mockResolvedValueOnce({ thread, messages: [] })
      .mockRejectedValueOnce(new Error("raw database transport detail"));
    vi.mocked(repo.beginSeedTurn).mockRejectedValue(
      new Error("ASK_OTOMOTO_SEED_ALREADY_CLAIMED")
    );

    await expect(
      generateDiagnosticsTriggerResponseInternal(
        {
          userId: actor("technician").user_id,
          locationId: scope().locationId,
        },
        {
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          trigger: "inspection_completion",
          triggerEntityId,
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_LIFECYCLE_FAILED");
  });

  it("revalidates the trusted creator and exact trigger scope before beginning", async () => {
    const { repo, thread } = triggerRepository();
    vi.mocked(repo.loadThread)
      .mockReset()
      .mockResolvedValue({
        thread: {
          ...thread,
          createdByUserId: "f1111111-1111-4111-8111-111111111111",
        },
        messages: [],
      });

    await expect(
      generateDiagnosticsTriggerResponseInternal(
        {
          userId: actor("technician").user_id,
          locationId: scope().locationId,
        },
        {
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          trigger: "inspection_completion",
          triggerEntityId,
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
    expect(repo.beginSeedTurn).not.toHaveBeenCalled();
  });

  it("rejects a trigger thread whose optional job is outside the work-order scope", async () => {
    const { repo, thread } = triggerRepository();
    vi.mocked(repo.loadThread)
      .mockReset()
      .mockResolvedValue({
        thread: {
          ...thread,
          jobId: "f1111111-1111-4111-8111-111111111111",
        },
        messages: [],
      });

    await expect(
      generateDiagnosticsTriggerResponseInternal(
        {
          userId: actor("technician").user_id,
          locationId: scope().locationId,
        },
        {
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          trigger: "inspection_completion",
          triggerEntityId,
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
    expect(repo.beginSeedTurn).not.toHaveBeenCalled();
  });

  it.each([
    "DIAGNOSTICS_AI_NOT_CONFIGURED",
    "DIAGNOSTICS_AI_PROVIDER_UNAVAILABLE",
    "DIAGNOSTICS_AI_OUTPUT_WITHHELD",
  ])("persists %s as a retryable failed seed", async (safeErrorCode) => {
    const { repo, thread, generated } = triggerRepository();

    await expect(
      generateDiagnosticsTriggerResponseInternal(
        {
          userId: actor("technician").user_id,
          locationId: scope().locationId,
        },
        {
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          trigger: "inspection_completion",
          triggerEntityId,
        },
        {
          repository: repo,
          generateDraft: async () => {
            throw new Error(safeErrorCode);
          },
          prepareImages: async () => ({ images: [], photoMetadata: [] }),
        }
      )
    ).rejects.toThrow(safeErrorCode);

    expect(repo.failGeneration).toHaveBeenCalledWith({
      threadId: thread.threadId,
      assistantMessageId: generated.messageId,
      attemptId: "attempt-1",
      safeErrorCode,
    });
  });
});

describe("Ask OTOMOTO internal job-completion generation", () => {
  const jobId = "51111111-1111-4111-8111-111111111111";
  const triggerEntityId = jobId;
  const thread = {
    threadId: "71111111-1111-4111-8111-111111111111",
    workOrderId: scope().workOrderId,
    jobId,
    locationId: scope().locationId,
    mode: "shop" as const,
    audience: "technical" as const,
    status: "pending" as const,
    diagnosticPhase: null,
    triggerType: "job_completed" as const,
    triggerEntityId,
    createdByUserId: actor("technician").user_id,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };

  function jobTriggerRepository() {
    const repo = repository();
    const generated = {
      messageId: "a1111111-1111-4111-8111-111111111111",
      threadId: thread.threadId,
      role: "assistant" as const,
      body: "Generated job-completion closure review",
      generationStatus: "ready" as const,
      requestedInput: generationResult().response.requested_input,
      phase: "closure_report" as const,
      safeErrorCode: null,
      parentUserMessageId: "b1111111-1111-4111-8111-111111111111",
      requestedProviderModel: "model-alias",
      providerModel: "model-resolved-2",
      createdAt: "2026-09-29T01:00:00.000Z",
      updatedAt: "2026-09-29T01:00:00.000Z",
      photos: [],
    };
    vi.mocked(repo.loadThread)
      .mockResolvedValueOnce({ thread, messages: [] })
      .mockResolvedValueOnce({
        thread: { ...thread, status: "ready", diagnosticPhase: "closure_report" },
        messages: [generated],
      });
    vi.mocked(repo.beginSeedTurn).mockResolvedValue({
      userMessageId: generated.parentUserMessageId!,
      assistantMessageId: generated.messageId,
      attemptId: "attempt-1",
    });
    vi.mocked(repo.loadGenerationInput).mockResolvedValue({
      userMessageId: generated.parentUserMessageId!,
      assistantMessageId: generated.messageId,
      userMessage: JOB_COMPLETION_SEED_REQUEST,
      photos: [],
      selectedPhotoMetadata: [],
      history: [],
    });
    const source = contextSource();
    source.jobs[0] = {
      ...source.jobs[0]!,
      status: "completed",
      workState: "completed",
      completedAt: "2026-09-29T00:30:00.000Z",
      verification: [],
    };
    vi.mocked(repo.loadContextSource).mockResolvedValue({
      source,
      redactTerms: {},
    });
    return { repo, generated };
  }

  it("atomically seeds one photo-free closure review with completed-work context", async () => {
    const { repo } = jobTriggerRepository();
    const generateDraft = vi
      .fn()
      .mockImplementation(
        async (
          _request: DiagnosticsGenerationRequest
        ): Promise<DiagnosticsGenerationResult> => ({
          ...generationResult(),
          response: {
            ...generationResult().response,
            phase: "closure_report",
          },
        })
      );
    const prepareImages = vi.fn().mockResolvedValue({
      images: [],
      photoMetadata: [],
    });

    await generateDiagnosticsTriggerResponseInternal(
      {
        userId: actor("technician").user_id,
        locationId: scope().locationId,
      },
      {
        workOrderId: scope().workOrderId,
        threadId: thread.threadId,
        jobId,
        trigger: "job_completion",
        triggerEntityId,
      },
      { repository: repo, generateDraft, prepareImages }
    );

    expect(JOB_COMPLETION_SEED_REQUEST).toMatch(/recorded job\/work-order facts/i);
    expect(JOB_COMPLETION_SEED_REQUEST).toMatch(/reported repair.*actual verification/i);
    expect(JOB_COMPLETION_SEED_REQUEST).toContain(
      "repair performed; verification pending"
    );
    expect(JOB_COMPLETION_SEED_REQUEST).toMatch(
      /single immediate verification\/review input/i
    );
    expect(JOB_COMPLETION_SEED_REQUEST).toMatch(/compact Shop Log/i);
    expect(JOB_COMPLETION_SEED_REQUEST).toMatch(
      /no pass\/fail, QC, release, or roadworthiness claim/i
    );
    expect(JOB_COMPLETION_SEED_REQUEST).toMatch(/do not automatically attach photos/i);
    expect(repo.beginSeedTurn).toHaveBeenCalledWith({
      workOrderId: scope().workOrderId,
      threadId: thread.threadId,
      triggerType: "job_completed",
      triggerEntityId,
      userId: actor("technician").user_id,
      text: JOB_COMPLETION_SEED_REQUEST,
    });
    expect(prepareImages).toHaveBeenCalledWith(
      expect.objectContaining({ jobId, selections: [] }),
      repo
    );
    const request = generateDraft.mock.calls[0]![0] as DiagnosticsGenerationRequest;
    expect(request.images).toEqual([]);
    expect(request.requiredPhase).toBe("closure_report");
    expect(request.workOrderContext.selectedJob).toMatchObject({
      jobId,
      status: "completed",
      completedAt: "2026-09-29T00:30:00.000Z",
      verification: [],
      verificationEvidenceRecorded: false,
    });
  });

  it("rejects an inactive trigger-thread creator before claiming or generating", async () => {
    const { repo } = jobTriggerRepository();
    vi.mocked(repo.isActiveUserAtLocation).mockResolvedValue(false);

    await expect(
      generateDiagnosticsTriggerResponseInternal(
        {
          userId: actor("technician").user_id,
          locationId: scope().locationId,
        },
        {
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          jobId,
          trigger: "job_completion",
          triggerEntityId,
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_TRIGGER_CREATOR_INACTIVE");
    expect(repo.isActiveUserAtLocation).toHaveBeenCalledWith(
      actor("technician").user_id,
      scope().locationId
    );
    expect(repo.beginSeedTurn).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong job", { jobId: "81111111-1111-4111-8111-111111111111" }],
    ["missing job", { jobId: null }],
    ["wrong trigger", { triggerType: "inspection_completed" as const }],
    ["wrong trigger entity", { triggerEntityId: "81111111-1111-4111-8111-111111111111" }],
    ["wrong creator", { createdByUserId: "81111111-1111-4111-8111-111111111111" }],
    ["wrong location", { locationId: "81111111-1111-4111-8111-111111111111" }],
  ])("rejects a job-completion thread with %s", async (_label, override) => {
    const { repo } = jobTriggerRepository();
    vi.mocked(repo.loadThread)
      .mockReset()
      .mockResolvedValue({
        thread: { ...thread, ...override },
        messages: [],
      });

    await expect(
      generateDiagnosticsTriggerResponseInternal(
        {
          userId: actor("technician").user_id,
          locationId: scope().locationId,
        },
        {
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          jobId,
          trigger: "job_completion",
          triggerEntityId,
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
    expect(repo.beginSeedTurn).not.toHaveBeenCalled();
  });

  it("rejects mismatched requested job and trigger entity before claiming a seed", async () => {
    const { repo } = jobTriggerRepository();

    await expect(
      generateDiagnosticsTriggerResponseInternal(
        {
          userId: actor("technician").user_id,
          locationId: scope().locationId,
        },
        {
          workOrderId: scope().workOrderId,
          threadId: thread.threadId,
          jobId,
          trigger: "job_completion",
          triggerEntityId: "81111111-1111-4111-8111-111111111111",
        },
        { repository: repo }
      )
    ).rejects.toThrow("ASK_OTOMOTO_TRIGGER_SCOPE_MISMATCH");
    expect(repo.loadThread).not.toHaveBeenCalled();
    expect(repo.beginSeedTurn).not.toHaveBeenCalled();
  });
});
