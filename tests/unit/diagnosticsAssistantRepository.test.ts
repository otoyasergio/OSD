import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/database/types";
import {
  SupabaseDiagnosticsRepository,
  type DiagnosticsMessageView,
} from "@/lib/services/diagnosticsAssistant";
import {
  DIAGNOSTICS_MAX_HISTORY_CHARS,
  DIAGNOSTICS_MAX_HISTORY_MESSAGES,
  DIAGNOSTICS_MAX_MESSAGE_CHARS,
} from "@/lib/diagnostics/openai";

type Result = { data: unknown; error: null };

class FakeQuery implements PromiseLike<Result> {
  constructor(
    private readonly result: Result,
    private readonly selects: string[],
    private readonly table: string,
    private readonly filters: string[],
    private readonly inserts: Array<{ table: string; value: unknown }>
  ) {}

  select(columns: string) {
    this.selects.push(`${this.table}:${columns}`);
    return this;
  }
  insert(value: unknown) {
    this.inserts.push({ table: this.table, value });
    return this;
  }
  update() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push(`${this.table}:${column}=${String(value)}`);
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
  selects: string[] = [],
  filters: string[] = [],
  inserts: Array<{ table: string; value: unknown }> = []
): DbClient {
  return {
    from(table: string) {
      calls.push(table);
      return new FakeQuery(
        { data: results[table] ?? null, error: null },
        selects,
        table,
        filters,
        inserts
      );
    },
    rpc: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  } as unknown as DbClient;
}

function threadRow() {
  return {
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
  };
}

function messageRow(
  id: string,
  role: DiagnosticsMessageView["role"],
  body: string | null,
  options: {
    parentUserMessageId?: string | null;
    generationStatus?: DiagnosticsMessageView["generationStatus"];
    requestedInput?: unknown;
    createdAt?: string;
  } = {}
) {
  return {
    ai_assistant_message_id: id,
    thread_id: "thread-1",
    role,
    body,
    generation_status: options.generationStatus ?? "ready",
    requested_input: options.requestedInput ?? null,
    phase: role === "assistant" ? "diagnosis" : null,
    safe_error_code: null,
    parent_user_message_id: options.parentUserMessageId ?? null,
    requested_provider_model: null,
    provider_model: null,
    created_at: options.createdAt ?? "2026-09-29T00:00:00.000Z",
    updated_at: options.createdAt ?? "2026-09-29T00:00:00.000Z",
  };
}

function generationRepository(messages: Array<Record<string, unknown>>) {
  return new SupabaseDiagnosticsRepository(
    fakeClient(
      {
        ai_assistant_thread: threadRow(),
        ai_assistant_message: messages,
        ai_assistant_message_photo: [],
      },
      []
    ),
    vi.fn()
  );
}

describe("Supabase diagnostics repository boundaries", () => {
  it("requires an active trigger creator with membership at the thread location", async () => {
    const filters: string[] = [];
    const repository = new SupabaseDiagnosticsRepository(
      fakeClient(
        {
          app_user: { user_id: "user-1", status: "active" },
          user_location: {
            user_id: "user-1",
            location_id: "loc-1",
            location: { status: "active" },
          },
        },
        [],
        [],
        filters
      ),
      vi.fn()
    );

    await expect(repository.isActiveUserAtLocation("user-1", "loc-1")).resolves.toBe(
      true
    );
    expect(filters).toEqual(
      expect.arrayContaining([
        "app_user:user_id=user-1",
        "app_user:status=active",
        "user_location:user_id=user-1",
        "user_location:location_id=loc-1",
      ])
    );
  });

  it("accepts a job-completion trigger entity only when the job is completed", async () => {
    const filters: string[] = [];
    const repository = new SupabaseDiagnosticsRepository(
      fakeClient({ job: { job_id: "job-1" } }, [], [], filters),
      vi.fn()
    );

    await expect(
      repository.triggerEntityBelongsToWorkOrder("wo-1", "job_completed", "job-1")
    ).resolves.toBe(true);
    expect(filters).toContain("job:status=completed");
  });

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

  it("reads promoted note provenance through the session client for this work order", async () => {
    const selects: string[] = [];
    const filters: string[] = [];
    const sessionCalls: string[] = [];
    const createAdmin = vi.fn();
    const repository = new SupabaseDiagnosticsRepository(
      fakeClient(
        {
          technician_note: [
            { technician_note_id: "note-1", source_ai_message_id: "assistant-1" },
            { technician_note_id: "note-x", source_ai_message_id: null },
          ],
        },
        sessionCalls,
        selects,
        filters
      ),
      createAdmin
    );

    const promoted = await repository.listPromotedNoteIds("wo-1", ["assistant-1"]);

    expect([...promoted]).toEqual([["assistant-1", "note-1"]]);
    expect(sessionCalls).toEqual(["technician_note"]);
    expect(filters).toContain("technician_note:work_order_id=wo-1");
    expect(selects.join("\n")).toBe(
      "technician_note:technician_note_id, source_ai_message_id"
    );
    expect(createAdmin).not.toHaveBeenCalled();
    await expect(repository.listPromotedNoteIds("wo-1", [])).resolves.toEqual(new Map());
    expect(sessionCalls).toEqual(["technician_note"]);
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

  describe("claimed-turn history compatibility", () => {
    function currentRows(prior: Array<Record<string, unknown>>, body = "Latest request") {
      return [
        ...prior,
        messageRow("current-user", "user", body),
        messageRow("current-assistant", "assistant", null, {
          parentUserMessageId: "current-user",
          generationStatus: "generating",
        }),
      ];
    }

    async function load(prior: Array<Record<string, unknown>>, body?: string) {
      return generationRepository(currentRows(prior, body)).loadGenerationInput(
        "wo-1",
        "thread-1",
        "current-user",
        "current-assistant"
      );
    }

    it("keeps the complete current staff request and compacts an oversized ready answer", async () => {
      const oversized = [
        "**SAFETY — BOUNDARY:** Keep the motorcycle secure.",
        "",
        "**Assessments:** possible: charging fault.",
        "",
        "The recorded evidence does not yet isolate the fault.",
        "",
        "**Sources/status:** No exact-model source supplied.",
        "",
        "**Limitations:** " + "x".repeat(DIAGNOSTICS_MAX_MESSAGE_CHARS * 2),
        "",
        "**NEXT STEP:** Measure battery voltage under load.",
      ].join("\n");
      const latestRequest = "Complete latest staff request " + "u".repeat(2_000);
      const result = await load(
        [
          messageRow("user-1", "user", "Earlier request"),
          messageRow("assistant-1", "assistant", oversized, {
            parentUserMessageId: "user-1",
          }),
        ],
        latestRequest
      );

      expect(result.userMessage).toBe(latestRequest);
      expect(result.history).toHaveLength(2);
      expect(result.history[1]).toMatchObject({ role: "assistant" });
      expect(result.history[1]!.content).toContain("SAFETY");
      expect(result.history[1]!.content).toContain("Assessments");
      expect(result.history[1]!.content).toContain("NEXT STEP");
      expect(result.history[1]!.content.length).toBeLessThanOrEqual(
        DIAGNOSTICS_MAX_MESSAGE_CHARS
      );
    });

    it("keeps exactly the provider message and aggregate boundaries", async () => {
      const prior = Array.from(
        { length: DIAGNOSTICS_MAX_HISTORY_MESSAGES / 2 },
        (_, index) => {
          const userId = `user-${index}`;
          return [
            messageRow(userId, "user", `u${index}`.padEnd(4_000, "u")),
            messageRow(
              `assistant-${index}`,
              "assistant",
              `a${index}`.padEnd(4_000, "a"),
              { parentUserMessageId: userId }
            ),
          ];
        }
      ).flat();
      const result = await load(prior);

      expect(result.history).toHaveLength(DIAGNOSTICS_MAX_HISTORY_MESSAGES);
      expect(result.history.reduce((sum, item) => sum + item.content.length, 0)).toBe(
        DIAGNOSTICS_MAX_HISTORY_CHARS
      );
      expect(result.history.every((item) => item.content.length === 4_000)).toBe(true);
    });

    it("selects complete newest turns first when stored history exceeds both limits", async () => {
      const prior = Array.from({ length: 12 }, (_, index) => {
        const userId = `user-${String(index).padStart(2, "0")}`;
        return [
          messageRow(userId, "user", `request-${index}-${"u".repeat(4_090)}`),
          messageRow(
            `assistant-${String(index).padStart(2, "0")}`,
            "assistant",
            `answer-${index}-${"a".repeat(4_090)}`,
            { parentUserMessageId: userId }
          ),
        ];
      }).flat();
      const result = await load(prior);
      const content = result.history.map((item) => item.content);

      expect(result.history.length).toBeLessThanOrEqual(DIAGNOSTICS_MAX_HISTORY_MESSAGES);
      expect(
        result.history.reduce((sum, item) => sum + item.content.length, 0)
      ).toBeLessThanOrEqual(DIAGNOSTICS_MAX_HISTORY_CHARS);
      expect(
        result.history.every(
          (item) => item.content.length <= DIAGNOSTICS_MAX_MESSAGE_CHARS
        )
      ).toBe(true);
      expect(content.join("\n")).toContain("request-11-");
      expect(content.join("\n")).not.toContain("request-0-");
      expect(result.history.map((item) => item.role)).toEqual(
        Array.from({ length: result.history.length / 2 }, () => [
          "user",
          "assistant",
        ]).flat()
      );
    });

    it("stops at the first newer turn that cannot fit instead of leaving a history gap", async () => {
      const turn = (label: string, chars: number) => [
        messageRow(`${label}-user`, "user", `${label}-request-`.padEnd(chars, "u")),
        messageRow(
          `${label}-assistant`,
          "assistant",
          `${label}-answer-`.padEnd(chars, "a"),
          {
            parentUserMessageId: `${label}-user`,
          }
        ),
      ];
      const prior = [
        ...turn("oldest-small", 1_000),
        ...turn("middle-blocker", 4_000),
        ...Array.from({ length: 5 }, (_, index) => turn(`newer-${index}`, 6_000)).flat(),
      ];

      const result = await load(prior);
      const content = result.history.map((message) => message.content).join("\n");

      expect(result.history).toHaveLength(10);
      expect(content).toContain("newer-0-request-");
      expect(content).toContain("newer-4-answer-");
      expect(content).not.toContain("middle-blocker");
      expect(content).not.toContain("oldest-small");
    });

    it("excludes orphaned or cross-parent answers instead of attributing them to a staff turn", async () => {
      const result = await load([
        messageRow("user-1", "user", "Matched staff request"),
        messageRow("assistant-orphan", "assistant", "Unrelated answer", {
          parentUserMessageId: "missing-user",
        }),
        messageRow("assistant-1", "assistant", "Matched answer", {
          parentUserMessageId: "user-1",
        }),
      ]);

      expect(result.history).toEqual([
        { role: "user", content: "Matched staff request" },
        { role: "assistant", content: "Matched answer" },
      ]);
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
          mileage_unit: "mi",
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
        job: [
          {
            job_id: "job-1",
            work_order_id: "wo-1",
            origin: "customer_request",
            service_name_snapshot: "Charging repair",
            status: "completed",
            work_state: "completed",
            notes: "Connector repaired",
            completed_at: "2026-09-29T00:30:00.000Z",
          },
        ],
        motorcycle_service_information: null,
        inspection: null,
        technician_note: [
          {
            technician_note_id: "note-pass",
            work_order_id: "wo-1",
            job_id: "job-1",
            note_type: "road_test",
            note: "Comparable road test passed under the original conditions.",
            created_at: "2026-09-29T01:00:00.000Z",
          },
          {
            technician_note_id: "note-pending",
            work_order_id: "wo-1",
            job_id: "job-1",
            note_type: "quality_check",
            note: "Quality check pending final electrical retest.",
            created_at: "2026-09-29T01:01:00.000Z",
          },
          {
            technician_note_id: "note-failed",
            work_order_id: "wo-1",
            job_id: "job-1",
            note_type: "road_test",
            note: "Road test failed: original symptom recurred.",
            created_at: "2026-09-29T01:02:00.000Z",
          },
          {
            technician_note_id: "note-other-job",
            work_order_id: "wo-1",
            job_id: "job-2",
            note_type: "road_test",
            note: "Other job passed.",
            created_at: "2026-09-29T01:03:00.000Z",
          },
        ],
        recommendation: [],
        quality_check_attempt: [],
        safety_check_attempt: [],
        job_checklist_item: [],
        job_part_requirement: [],
        intake_photo: [],
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

    const context = await repository.loadContextSource("wo-1", "job-1", false);

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
    expect(context.source.workOrder).toMatchObject({
      mileage: 100,
      mileageUnit: "mi",
    });
    expect(context.source.motorcycle.odometerUnit).toBe("km");
    expect(context.source.jobs[0]?.verification).toEqual([
      {
        verificationId: "note-pass",
        result: "passed",
        notes: "Comparable road test passed under the original conditions.",
        recordedAt: "2026-09-29T01:00:00.000Z",
      },
      {
        verificationId: "note-pending",
        result: "pending",
        notes: "Quality check pending final electrical retest.",
        recordedAt: "2026-09-29T01:01:00.000Z",
      },
      {
        verificationId: "note-failed",
        result: "failed",
        notes: "Road test failed: original symptom recurred.",
        recordedAt: "2026-09-29T01:02:00.000Z",
      },
    ]);
    expect(JSON.stringify(context.source.jobs[0]?.verification)).not.toContain(
      "Other job passed"
    );
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

  it("maps the trigger-only atomic seed RPC without photos", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          user_message_id: "seed-user-1",
          assistant_message_id: "seed-assistant-1",
          generation_attempt_id: "seed-attempt-1",
        },
      ],
      error: null,
    });
    const repository = new SupabaseDiagnosticsRepository(fakeClient({}, []), () => {
      return { rpc } as unknown as DbClient;
    });

    await expect(
      repository.beginSeedTurn({
        workOrderId: "wo-1",
        threadId: "thread-1",
        triggerType: "inspection_completed",
        triggerEntityId: "inspection-1",
        userId: "user-1",
        text: "Review the completed inspection",
      })
    ).resolves.toEqual({
      userMessageId: "seed-user-1",
      assistantMessageId: "seed-assistant-1",
      attemptId: "seed-attempt-1",
    });

    expect(rpc).toHaveBeenCalledWith("ask_otomoto_begin_seed_turn", {
      p_thread_id: "thread-1",
      p_work_order_id: "wo-1",
      p_trigger_type: "inspection_completed",
      p_trigger_entity_id: "inspection-1",
      p_user_id: "user-1",
      p_body: "Review the completed inspection",
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

  it("records acceptance metadata once per location and resolved model", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const select = vi.fn().mockReturnThis();
    const admin = {
      from: vi.fn(() => ({
        select,
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert,
      })),
    } as unknown as DbClient;
    const repository = new SupabaseDiagnosticsRepository(fakeClient({}, []), () => admin);

    await repository.recordModelChangeAudit({
      actorUserId: "user-1",
      locationId: "loc-1",
      messageId: "message-1",
      previousModel: "model-old",
      requestedModel: "model-alias",
      resolvedModel: "model-new",
      promptVersion: "otomoto-moto-diagnostics-v1.4.1",
      acceptanceRerunRequired: true,
      scenarioCount: 18,
    });

    expect(select).toHaveBeenCalledWith("audit_log_id");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        new_value: {
          requested_model: "model-alias",
          resolved_model: "model-new",
          prompt_version: "otomoto-moto-diagnostics-v1.4.1",
          acceptance_rerun_required: true,
          scenario_count: 18,
        },
      })
    );
  });

  it("records automatic recovery as metadata only with the clicking actor", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const admin = {
      from: vi.fn(() => ({ insert })),
    } as unknown as DbClient;
    const repository = new SupabaseDiagnosticsRepository(fakeClient({}, []), () => admin);

    await repository.recordAutomaticRecoveryAudit({
      actorUserId: "clicking-user",
      locationId: "location-1",
      threadId: "thread-1",
      triggerType: "inspection_completed",
      triggerEntityId: "inspection-1",
    });

    expect(insert).toHaveBeenCalledWith({
      actor_user_id: "clicking-user",
      location_id: "location-1",
      action: "ask_otomoto_automatic_recovery_requested",
      entity_type: "ai_assistant_thread",
      entity_id: "thread-1",
      description: "Ask OTOMOTO automatic review recovery requested",
      old_value: null,
      new_value: {
        thread_id: "thread-1",
        trigger_type: "inspection_completed",
        trigger_entity_id: "inspection-1",
      },
    });
    expect(JSON.stringify(insert.mock.calls)).not.toMatch(
      /content|body|prompt|response/i
    );
  });

  it("does not duplicate a model acceptance audit for the same location and resolved model", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const select = vi.fn().mockReturnThis();
    const admin = {
      from: vi.fn(() => ({
        select,
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { audit_log_id: "audit-1" },
          error: null,
        }),
        insert,
      })),
    } as unknown as DbClient;
    const repository = new SupabaseDiagnosticsRepository(fakeClient({}, []), () => admin);

    await repository.recordModelChangeAudit({
      actorUserId: "user-1",
      locationId: "loc-1",
      messageId: "message-2",
      previousModel: "model-old",
      requestedModel: "model-alias",
      resolvedModel: "model-new",
      promptVersion: "otomoto-moto-diagnostics-v1.4.1",
      acceptanceRerunRequired: true,
      scenarioCount: 18,
    });

    expect(select).toHaveBeenCalledWith("audit_log_id");
    expect(insert).not.toHaveBeenCalled();
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
