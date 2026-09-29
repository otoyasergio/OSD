import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/database/types";
import { SupabaseDiagnosticsRepository } from "@/lib/services/diagnosticsAssistant";

type Result = { data: unknown; error: null };

class FakeQuery implements PromiseLike<Result> {
  constructor(
    private readonly result: Result,
    private readonly selects: string[],
    private readonly table: string
  ) {}

  select(columns: string) {
    this.selects.push(`${this.table}:${columns}`);
    return this;
  }
  insert() {
    return this;
  }
  update() {
    return this;
  }
  eq() {
    return this;
  }
  neq() {
    return this;
  }
  not() {
    return this;
  }
  in() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  single() {
    return Promise.resolve(this.result);
  }
  maybeSingle() {
    return Promise.resolve(this.result);
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function fakeClient(
  results: Record<string, unknown>,
  calls: string[],
  selects: string[] = []
): DbClient {
  return {
    from(table: string) {
      calls.push(table);
      return new FakeQuery({ data: results[table] ?? null, error: null }, selects, table);
    },
    rpc: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  } as unknown as DbClient;
}

describe("Supabase diagnostics repository boundaries", () => {
  it("uses session/RLS reads without constructing an admin client", async () => {
    const sessionCalls: string[] = [];
    const session = fakeClient(
      {
        work_order: {
          work_order_id: "wo-1",
          location_id: "loc-1",
          status: "in_progress",
          primary_technician_id: "user-1",
          quality_check_assigned_to: null,
          location: { status: "active" },
          jobs: [],
        },
        ai_assistant_thread: [],
        intake_photo: [],
      },
      sessionCalls
    );
    const createAdmin = vi.fn();
    const repository = new SupabaseDiagnosticsRepository(session, createAdmin);

    await repository.loadWorkOrderScope("wo-1");
    await repository.listThreads("wo-1");
    await repository.findTriggerThread("wo-1", "inspection_completed", "inspection-1");
    await repository.loadPhotoRows("wo-1", ["photo-1"]);

    expect(sessionCalls).toEqual([
      "work_order",
      "ai_assistant_thread",
      "ai_assistant_thread",
      "intake_photo",
    ]);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("maps explicit parent and requested/resolved model columns", async () => {
    const selects: string[] = [];
    const session = fakeClient(
      {
        ai_assistant_thread: {
          ai_assistant_thread_id: "thread-1",
          work_order_id: "wo-1",
          job_id: null,
          location_id: "loc-1",
          mode: "shop",
          audience: "technical",
          status: "ready",
          diagnostic_phase: "diagnosis",
          trigger_type: null,
          created_at: "2026-09-29T00:00:00.000Z",
          updated_at: "2026-09-29T00:00:00.000Z",
        },
        ai_assistant_message: [
          {
            ai_assistant_message_id: "assistant-1",
            thread_id: "thread-1",
            role: "assistant",
            body: "Ready",
            generation_status: "ready",
            requested_input: null,
            phase: "diagnosis",
            safe_error_code: null,
            parent_user_message_id: "user-1",
            requested_provider_model: "model-alias",
            provider_model: "model-resolved",
            created_at: "2026-09-29T00:00:00.000Z",
            updated_at: "2026-09-29T00:00:00.000Z",
          },
        ],
        ai_assistant_message_photo: [],
      },
      [],
      selects
    );
    const repository = new SupabaseDiagnosticsRepository(session, vi.fn());

    const workspace = await repository.loadThread("wo-1", "thread-1");

    expect(workspace?.messages[0]).toMatchObject({
      parentUserMessageId: "user-1",
      requestedProviderModel: "model-alias",
      providerModel: "model-resolved",
    });
    expect(selects.join("\n")).toContain("parent_user_message_id");
    expect(selects.join("\n")).toContain("requested_provider_model");
  });

  it("loads a claimed turn by explicit parent IDs without relying on adjacency", async () => {
    const session = fakeClient(
      {
        ai_assistant_thread: {
          ai_assistant_thread_id: "thread-1",
          work_order_id: "wo-1",
          job_id: null,
          location_id: "loc-1",
          mode: "shop",
          audience: "technical",
          status: "generating",
          diagnostic_phase: "diagnosis",
          trigger_type: null,
          created_at: "2026-09-29T00:00:00.000Z",
          updated_at: "2026-09-29T00:00:00.000Z",
        },
        ai_assistant_message: [
          {
            ai_assistant_message_id: "assistant-1",
            thread_id: "thread-1",
            role: "assistant",
            body: null,
            generation_status: "generating",
            requested_input: null,
            phase: "diagnosis",
            safe_error_code: null,
            parent_user_message_id: "user-1",
            requested_provider_model: null,
            provider_model: null,
            created_at: "2026-09-29T00:00:00.000Z",
            updated_at: "2026-09-29T00:00:00.000Z",
          },
          {
            ai_assistant_message_id: "user-1",
            thread_id: "thread-1",
            role: "user",
            body: "Explicit request",
            generation_status: "ready",
            requested_input: null,
            phase: null,
            safe_error_code: null,
            parent_user_message_id: null,
            requested_provider_model: null,
            provider_model: null,
            created_at: "2026-09-29T00:00:00.000Z",
            updated_at: "2026-09-29T00:00:00.000Z",
          },
        ],
        ai_assistant_message_photo: [],
      },
      []
    );
    const repository = new SupabaseDiagnosticsRepository(session, vi.fn());

    await expect(
      repository.loadGenerationInput("wo-1", "thread-1", "user-1", "assistant-1")
    ).resolves.toMatchObject({
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
      userMessage: "Explicit request",
    });
  });

  it("loads business context through session and uses admin only for redact terms", async () => {
    const sessionCalls: string[] = [];
    const adminCalls: string[] = [];
    const session = fakeClient(
      {
        work_order: {
          work_order_id: "wo-1",
          work_order_number: "WO-1",
          status: "in_progress",
          lifecycle_state: "active",
          mileage: 100,
          internal_notes: null,
          motorcycle_id: "motorcycle-1",
        },
        motorcycle: {
          motorcycle_id: "motorcycle-1",
          year: 2026,
          make: "Honda",
          model: "CB500F",
          colour: null,
          odometer_unit: "km",
          notes: null,
        },
        job: [],
        motorcycle_service_information: null,
        inspection: null,
        technician_note: [],
        recommendation: [],
        quality_check_attempt: [],
        safety_check_attempt: [],
      },
      sessionCalls
    );
    const admin = fakeClient(
      {
        motorcycle: {
          customer_id: "customer-1",
          vin: "VIN-SECRET",
        },
        customer: {
          first_name: "Private",
          last_name: "Customer",
          email: "private@example.invalid",
          phone: "647-555-1234",
          address: "Private address",
        },
      },
      adminCalls
    );
    const repository = new SupabaseDiagnosticsRepository(session, () => admin);

    const context = await repository.loadContextSource("wo-1", null, false);

    expect(sessionCalls).toEqual(
      expect.arrayContaining([
        "work_order",
        "motorcycle",
        "job",
        "inspection",
        "technician_note",
      ])
    );
    expect(adminCalls).toEqual(["motorcycle", "customer"]);
    expect(JSON.stringify(context.source)).not.toContain("Private");
    expect(context.redactTerms).toMatchObject({
      customerName: "Private Customer",
      fullVin: "VIN-SECRET",
    });
  });

  it("maps atomic lifecycle RPC arguments exactly", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          user_message_id: "user-message-1",
          assistant_message_id: "assistant-message-1",
          generation_attempt_id: "attempt-1",
        },
      ],
      error: null,
    });
    const admin = {
      rpc,
    } as unknown as DbClient;
    const repository = new SupabaseDiagnosticsRepository(fakeClient({}, []), () => admin);

    await expect(
      repository.beginTurn({
        workOrderId: "wo-1",
        threadId: "thread-1",
        userId: "user-1",
        text: "Original text",
        photos: [{ photoId: "photo-1", purpose: "Original purpose", sortOrder: 0 }],
      })
    ).resolves.toEqual({
      userMessageId: "user-message-1",
      assistantMessageId: "assistant-message-1",
      attemptId: "attempt-1",
    });

    expect(rpc).toHaveBeenCalledWith("ask_otomoto_begin_turn", {
      p_thread_id: "thread-1",
      p_work_order_id: "wo-1",
      p_user_id: "user-1",
      p_body: "Original text",
      p_photos: [
        {
          photo_id: "photo-1",
          purpose: "Original purpose",
          sort_order: 0,
        },
      ],
    });
  });

  it("passes retry staleness as a database-clock interval", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          user_message_id: "user-message-1",
          assistant_message_id: "assistant-message-1",
          generation_attempt_id: "attempt-2",
        },
      ],
      error: null,
    });
    const repository = new SupabaseDiagnosticsRepository(fakeClient({}, []), () => {
      return { rpc } as unknown as DbClient;
    });

    await repository.claimLatestRetry("wo-1", "thread-1", 270_000);

    expect(rpc).toHaveBeenCalledWith("ask_otomoto_claim_retry", {
      p_thread_id: "thread-1",
      p_work_order_id: "wo-1",
      p_stale_after: "270000 milliseconds",
    });
  });

  it("loads location-global model metadata through narrow service-role access", async () => {
    const selects: string[] = [];
    const sessionCalls: string[] = [];
    const adminCalls: string[] = [];
    const admin = fakeClient(
      {
        ai_assistant_message: {
          requested_provider_model: "model-alias",
          provider_model: "model-resolved-global",
        },
      },
      adminCalls,
      selects
    );
    const repository = new SupabaseDiagnosticsRepository(
      fakeClient({}, sessionCalls, selects),
      () => admin
    );

    await expect(
      repository.loadLatestSuccessfulModel("loc-1", "current-message")
    ).resolves.toEqual({
      requestedModel: "model-alias",
      resolvedModel: "model-resolved-global",
    });
    expect(selects.join("\n")).toContain("thread:ai_assistant_thread!inner(location_id)");
    expect(selects.join("\n")).not.toMatch(/\bbody\b|requested_input|safe_error_code/);
    expect(sessionCalls).toEqual([]);
    expect(adminCalls).toEqual(["ai_assistant_message"]);
  });

  it("does not fall back to service-role storage when session download is denied", async () => {
    const session = {
      storage: {
        from: vi.fn().mockReturnValue({
          download: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "storage denied" },
          }),
        }),
      },
    } as unknown as DbClient;
    const createAdmin = vi.fn();
    const repository = new SupabaseDiagnosticsRepository(session, createAdmin);

    await expect(
      repository.downloadPhoto("private/photo.jpg", { maxBytes: 1_000 })
    ).rejects.toThrow("DIAGNOSTICS_IMAGE_NOT_FOUND");
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("surfaces a simultaneous begin loser without partial client-side writes", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            user_message_id: "user-message-1",
            assistant_message_id: "assistant-message-1",
            generation_attempt_id: "attempt-1",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "ASK_OTOMOTO_THREAD_BUSY", code: "P0001" },
      });
    const repository = new SupabaseDiagnosticsRepository(fakeClient({}, []), () => {
      return { rpc } as unknown as DbClient;
    });
    const input = {
      workOrderId: "wo-1",
      threadId: "thread-1",
      userId: "user-1",
      text: "One request",
      photos: [],
    };

    const attempts = await Promise.allSettled([
      repository.beginTurn(input),
      repository.beginTurn(input),
    ]);

    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
