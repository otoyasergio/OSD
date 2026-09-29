import { describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/lib/auth/session";
import {
  assertDiagnosticsAccess,
  createOrReuseDiagnosticsTriggerThreadInternal,
  createDiagnosticsAssistantService,
  deriveDiagnosticsAudience,
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
    beginTurn: vi.fn(),
    loadGenerationInput: vi.fn(),
    completeGeneration: vi.fn(),
    failGeneration: vi.fn(),
    loadLatestFailedTurn: vi.fn(),
    loadContextSource: vi.fn(),
    loadPhotoRows: vi.fn(),
    downloadPhoto: vi.fn(),
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
    providerModel: "model-resolved-1",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    photos: [],
  };
  const generated = {
    ...previous,
    messageId: "a1111111-1111-4111-8111-111111111111",
    body: "Generated answer",
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
        safeErrorCode: code,
      });
    }
  });

  it("retries the existing failed assistant without creating another user message", async () => {
    const { repo, thread, generated } = generationRepository();
    vi.mocked(repo.loadLatestFailedTurn).mockResolvedValue({
      userMessageId: "b1111111-1111-4111-8111-111111111111",
      assistantMessageId: generated.messageId,
      userMessage: "Help diagnose it",
      photos: [],
      history: [],
      mode: "shop",
      jobId: thread.jobId,
    });
    const service = createDiagnosticsAssistantService({
      repository: repo,
      requireUser: async () => actor("technician"),
      generateDraft: async () => generationResult(),
      prepareImages: async () => ({ images: [], photoMetadata: [] }),
      consumeRateLimit: () => ({ success: true, remaining: 1, resetAt: 1 }),
    });

    await service.retryLatestFailed({
      workOrderId: scope().workOrderId,
      threadId: thread.threadId,
    });

    expect(repo.beginTurn).not.toHaveBeenCalled();
    expect(repo.completeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ assistantMessageId: generated.messageId })
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
      resolvedModel: "model-resolved-2",
    });
    expect(
      JSON.stringify(vi.mocked(repo.recordModelChangeAudit).mock.calls)
    ).not.toContain("Generated answer");
  });
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
});
