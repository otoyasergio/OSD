import { expect, it } from "vitest";
import {
  createAnonClient,
  createServiceClient,
  describeIntegration,
} from "@/tests/integration/helpers";

const IDS = {
  location: "d1000000-0000-4000-8000-000000000001",
  user: "d2000000-0000-4000-8000-000000000001",
  authUser: "d3000000-0000-4000-8000-000000000001",
  customer: "d4000000-0000-4000-8000-000000000001",
  motorcycle: "d5000000-0000-4000-8000-000000000001",
  service: "d6000000-0000-4000-8000-000000000001",
  workOrder: "d7000000-0000-4000-8000-000000000001",
  job: "d8000000-0000-4000-8000-000000000001",
  thread: "d9000000-0000-4000-8000-000000000001",
} as const;

const missingId = "da000000-0000-4000-8000-000000000001";
const authProbeId = "db000000-0000-4000-8000-000000000001";
const authProbeEmail = "diagnostics-rpc-probe@otomoto.invalid";
const authProbePassword = "Synthetic-Rpc-Probe-2026!";

function rpcArguments(name: string): Record<string, unknown> {
  switch (name) {
    case "ask_otomoto_begin_turn":
      return {
        p_thread_id: missingId,
        p_work_order_id: missingId,
        p_user_id: missingId,
        p_body: "Synthetic privilege probe",
        p_photos: [],
      };
    case "ask_otomoto_complete_turn":
      return {
        p_thread_id: missingId,
        p_assistant_message_id: missingId,
        p_generation_attempt_id: missingId,
        p_body: "Synthetic privilege probe",
        p_requested_input: null,
        p_phase: "diagnosis",
        p_requested_provider_model: "probe",
        p_resolved_provider_model: "probe",
        p_provider_response_id: "probe",
        p_prompt_version: "probe",
        p_input_token_count: null,
        p_output_token_count: null,
        p_context_as_of: null,
        p_context_hash: null,
      };
    case "ask_otomoto_fail_turn":
      return {
        p_thread_id: missingId,
        p_assistant_message_id: missingId,
        p_generation_attempt_id: missingId,
        p_safe_error_code: "DIAGNOSTICS_AI_PROVIDER_UNAVAILABLE",
      };
    case "ask_otomoto_claim_retry":
      return {
        p_thread_id: missingId,
        p_work_order_id: missingId,
        p_stale_after: "1 minute",
      };
    default:
      return {
        p_thread_id: missingId,
        p_work_order_id: missingId,
        p_trigger_type: "inspection_completed",
        p_trigger_entity_id: missingId,
        p_user_id: missingId,
        p_body: "Synthetic privilege probe",
      };
  }
}

const LIFECYCLE_RPCS = [
  "ask_otomoto_begin_turn",
  "ask_otomoto_complete_turn",
  "ask_otomoto_fail_turn",
  "ask_otomoto_claim_retry",
  "ask_otomoto_begin_seed_turn",
] as const;

async function cleanupLifecycleFixture(): Promise<void> {
  const client = createServiceClient();
  const deletes: Array<[string, string, string]> = [
    ["ai_assistant_thread", "ai_assistant_thread_id", IDS.thread],
    ["job", "job_id", IDS.job],
    ["work_order", "work_order_id", IDS.workOrder],
    ["motorcycle", "motorcycle_id", IDS.motorcycle],
    ["customer", "customer_id", IDS.customer],
    ["service", "service_id", IDS.service],
    ["user_location", "user_id", IDS.user],
    ["app_user", "user_id", IDS.user],
    ["location", "location_id", IDS.location],
  ];
  for (const [table, column, value] of deletes) {
    const { error } = await client.from(table).delete().eq(column, value);
    if (error) throw new Error(`[integration cleanup] ${table}: ${error.message}`);
  }
}

async function seedLifecycleFixture(): Promise<void> {
  await cleanupLifecycleFixture();
  const client = createServiceClient();
  const inserts: Array<[string, Record<string, unknown>]> = [
    [
      "location",
      { location_id: IDS.location, name: "Integration Synthetic", code: "AIQ" },
    ],
    [
      "app_user",
      {
        user_id: IDS.user,
        auth_user_id: IDS.authUser,
        first_name: "Integration",
        last_name: "Technician",
        email: "integration-technician@otomoto.invalid",
        role: "technician",
        status: "active",
      },
    ],
    ["user_location", { user_id: IDS.user, location_id: IDS.location }],
    [
      "customer",
      {
        customer_id: IDS.customer,
        first_name: "Synthetic",
        last_name: "Customer",
        email: "integration-customer@otomoto.invalid",
      },
    ],
    [
      "motorcycle",
      {
        motorcycle_id: IDS.motorcycle,
        customer_id: IDS.customer,
        year: 2021,
        make: "Example",
        model: "Integration",
      },
    ],
    ["service", { service_id: IDS.service, name: "Integration diagnostics" }],
    [
      "work_order",
      {
        work_order_id: IDS.workOrder,
        motorcycle_id: IDS.motorcycle,
        customer_id: IDS.customer,
        location_id: IDS.location,
        work_order_number: "AI-INTEGRATION-1",
        status: "in_progress",
        created_by_user_id: IDS.user,
        primary_technician_id: IDS.user,
      },
    ],
    [
      "job",
      {
        job_id: IDS.job,
        work_order_id: IDS.workOrder,
        service_id: IDS.service,
        service_name_snapshot: "Integration diagnostics",
        status: "in_progress",
        created_by_user_id: IDS.user,
        assigned_technician_id: IDS.user,
      },
    ],
    [
      "ai_assistant_thread",
      {
        ai_assistant_thread_id: IDS.thread,
        work_order_id: IDS.workOrder,
        job_id: IDS.job,
        location_id: IDS.location,
        mode: "shop",
        audience: "technical",
        status: "pending",
        created_by_user_id: IDS.user,
      },
    ],
  ];
  for (const [table, row] of inserts) {
    const { error } = await client.from(table).insert(row);
    if (error) throw new Error(`[integration seed] ${table}: ${error.message}`);
  }
}

describeIntegration("Ask OTOMOTO persistence integration", () => {
  it("has assistant storage and reviewed-note provenance columns", async () => {
    const client = createServiceClient();
    const [threads, messages, links, notes] = await Promise.all([
      client.from("ai_assistant_thread").select("ai_assistant_thread_id").limit(1),
      client
        .from("ai_assistant_message")
        .select(
          "ai_assistant_message_id, parent_user_message_id, requested_provider_model, generation_attempt_id"
        )
        .limit(1),
      client.from("ai_assistant_message_photo").select("message_id, photo_id").limit(1),
      client
        .from("technician_note")
        .select("technician_note_id, source_ai_message_id")
        .limit(1),
    ]);

    expect(threads.error).toBeNull();
    expect(messages.error).toBeNull();
    expect(links.error).toBeNull();
    expect(notes.error).toBeNull();
  });

  it("exposes every lifecycle RPC to service_role", async () => {
    const client = createServiceClient();
    for (const name of LIFECYCLE_RPCS) {
      const { error } = await client.rpc(name, rpcArguments(name));
      expect(error?.code, `${name} should exist in the PostgREST schema`).not.toBe(
        "PGRST202"
      );
      expect(error?.message ?? "", `${name} should not be privilege-denied`).not.toMatch(
        /permission denied/i
      );
    }
  });

  it.skipIf(!process.env.TEST_SUPABASE_ANON_KEY)(
    "denies every lifecycle RPC to anon",
    async () => {
      const client = createAnonClient();
      for (const name of LIFECYCLE_RPCS) {
        const { error } = await client.rpc(name, rpcArguments(name));
        expect(error, `${name} must not execute as anon`).not.toBeNull();
        expect(error?.message ?? "").toMatch(
          /permission denied|could not find the function|schema cache/i
        );
      }
    }
  );

  it.skipIf(!process.env.TEST_SUPABASE_ANON_KEY)(
    "denies every lifecycle RPC to authenticated",
    async () => {
      const service = createServiceClient();
      await service.auth.admin.deleteUser(authProbeId);
      const created = await service.auth.admin.createUser({
        id: authProbeId,
        email: authProbeEmail,
        password: authProbePassword,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const client = createAnonClient();
      try {
        const signedIn = await client.auth.signInWithPassword({
          email: authProbeEmail,
          password: authProbePassword,
        });
        expect(signedIn.error).toBeNull();
        for (const name of LIFECYCLE_RPCS) {
          const { error } = await client.rpc(name, rpcArguments(name));
          expect(error, `${name} must not execute as authenticated`).not.toBeNull();
          expect(error?.message ?? "").toMatch(
            /permission denied|could not find the function|schema cache/i
          );
        }
      } finally {
        await service.auth.admin.deleteUser(authProbeId);
      }
    }
  );

  it("atomically begins, fails, retries, and completes one isolated turn", async () => {
    await seedLifecycleFixture();
    const client = createServiceClient();
    try {
      const begin = await client.rpc("ask_otomoto_begin_turn", {
        p_thread_id: IDS.thread,
        p_work_order_id: IDS.workOrder,
        p_user_id: IDS.user,
        p_body: "Synthetic lifecycle request",
        p_photos: [],
      });
      expect(begin.error).toBeNull();
      const first = (Array.isArray(begin.data) ? begin.data[0] : begin.data) as {
        user_message_id: string;
        assistant_message_id: string;
        generation_attempt_id: string;
      };
      expect(first).toMatchObject({
        user_message_id: expect.any(String),
        assistant_message_id: expect.any(String),
        generation_attempt_id: expect.any(String),
      });

      const afterBegin = await client
        .from("ai_assistant_message")
        .select("ai_assistant_message_id", { count: "exact" })
        .eq("thread_id", IDS.thread);
      expect(afterBegin.error).toBeNull();
      expect(afterBegin.count).toBe(2);

      const failed = await client.rpc("ask_otomoto_fail_turn", {
        p_thread_id: IDS.thread,
        p_assistant_message_id: first.assistant_message_id,
        p_generation_attempt_id: first.generation_attempt_id,
        p_safe_error_code: "DIAGNOSTICS_AI_PROVIDER_UNAVAILABLE",
      });
      expect(failed.error).toBeNull();
      expect(failed.data).toBe(true);

      const retry = await client.rpc("ask_otomoto_claim_retry", {
        p_thread_id: IDS.thread,
        p_work_order_id: IDS.workOrder,
        p_stale_after: "1 minute",
      });
      expect(retry.error).toBeNull();
      const retried = (Array.isArray(retry.data) ? retry.data[0] : retry.data) as {
        user_message_id: string;
        assistant_message_id: string;
        generation_attempt_id: string;
      };
      expect(retried.user_message_id).toBe(first.user_message_id);
      expect(retried.assistant_message_id).toBe(first.assistant_message_id);
      expect(retried.generation_attempt_id).not.toBe(first.generation_attempt_id);

      const completed = await client.rpc("ask_otomoto_complete_turn", {
        p_thread_id: IDS.thread,
        p_assistant_message_id: retried.assistant_message_id,
        p_generation_attempt_id: retried.generation_attempt_id,
        p_body: "Synthetic ready output",
        p_requested_input: { type: "none", prompt: null },
        p_phase: "diagnosis",
        p_requested_provider_model: "synthetic-alias",
        p_resolved_provider_model: "synthetic-resolved",
        p_provider_response_id: "synthetic-response",
        p_prompt_version: "synthetic-prompt",
        p_input_token_count: 10,
        p_output_token_count: 20,
        p_context_as_of: "2026-09-29T08:00:00.000Z",
        p_context_hash: "a".repeat(64),
      });
      expect(completed.error).toBeNull();

      const [thread, message] = await Promise.all([
        client
          .from("ai_assistant_thread")
          .select("status, diagnostic_phase")
          .eq("ai_assistant_thread_id", IDS.thread)
          .single(),
        client
          .from("ai_assistant_message")
          .select(
            "generation_status, body, requested_provider_model, provider_model, safe_error_code"
          )
          .eq("ai_assistant_message_id", retried.assistant_message_id)
          .single(),
      ]);
      expect(thread.error).toBeNull();
      expect(thread.data).toMatchObject({
        status: "ready",
        diagnostic_phase: "diagnosis",
      });
      expect(message.error).toBeNull();
      expect(message.data).toMatchObject({
        generation_status: "ready",
        body: "Synthetic ready output",
        requested_provider_model: "synthetic-alias",
        provider_model: "synthetic-resolved",
        safe_error_code: null,
      });
    } finally {
      await cleanupLifecycleFixture();
    }
  });
});
