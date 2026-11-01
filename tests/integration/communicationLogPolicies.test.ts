import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAnonClient,
  createServiceClient,
  integrationConfigured,
} from "@/tests/integration/helpers";

/**
 * Real communication_log RLS coverage against an explicitly isolated database.
 * Never reads NEXT_PUBLIC_* credentials.
 */

const configured = integrationConfigured();
const anonConfigured = Boolean(process.env.TEST_SUPABASE_ANON_KEY?.trim());
const suiteReady = configured && anonConfigured;
const describePolicies = suiteReady ? describe : describe.skip;
const admin = suiteReady ? createServiceClient() : null;
const userId = randomUUID();
const logId = randomUUID();
const email = `it-communication-${userId.slice(0, 8)}@otomoto.invalid`;
const password = "Synthetic-Communication-RLS-2026!";

function requireAdmin(): SupabaseClient {
  if (!admin) {
    throw new Error(
      "communication log policy suite missing isolated TEST_SUPABASE service client"
    );
  }
  return admin;
}

async function cleanupFixtures(): Promise<void> {
  const service = requireAdmin();
  await service.from("communication_log").delete().eq("log_id", logId);
  await service.from("app_user").delete().eq("user_id", userId);
  await service.auth.admin.deleteUser(userId);
}

describePolicies("communication log policies (isolated db)", () => {
  beforeAll(async () => {
    const service = requireAdmin();
    await cleanupFixtures();

    const created = await service.auth.admin.createUser({
      id: userId,
      email,
      password,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);

    const staff = await service.from("app_user").insert({
      user_id: userId,
      auth_user_id: userId,
      first_name: "Communication",
      last_name: "Policy",
      email,
      role: "service_advisor",
      status: "active",
    });
    if (staff.error) throw new Error(staff.error.message);
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  it("blocks authenticated UPDATE while service role updates the same row", async () => {
    const staff = createAnonClient();
    const signIn = await staff.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(signIn.error.message);

    try {
      const inserted = await staff
        .from("communication_log")
        .insert({
          log_id: logId,
          channel: "sms",
          direction: "outbound",
          template_key: "approval_request",
          to_address: "+14165550123",
          body: "Synthetic integration fixture",
          status: "queued",
          sent_by_user_id: userId,
        })
        .select("log_id, status")
        .single();
      expect(inserted.error).toBeNull();
      expect(inserted.data?.status).toBe("queued");

      const userUpdate = await staff
        .from("communication_log")
        .update({ status: "sent" })
        .eq("log_id", logId)
        .select("log_id");
      expect(userUpdate.error).toBeNull();
      expect(userUpdate.data ?? []).toEqual([]);

      const service = requireAdmin();
      const unchanged = await service
        .from("communication_log")
        .select("status")
        .eq("log_id", logId)
        .single();
      expect(unchanged.error).toBeNull();
      expect(unchanged.data?.status).toBe("queued");

      const serviceUpdate = await service
        .from("communication_log")
        .update({ status: "sent" })
        .eq("log_id", logId)
        .select("log_id, status")
        .single();
      expect(serviceUpdate.error).toBeNull();
      expect(serviceUpdate.data).toEqual({ log_id: logId, status: "sent" });
    } finally {
      await staff.auth.signOut();
    }
  });
});

if (!configured) {
  it.skip(
    "communication log RLS integration skipped — set isolated TEST_SUPABASE_URL " +
      "and TEST_SUPABASE_SERVICE_ROLE_KEY (never NEXT_PUBLIC_* / production)",
    () => {}
  );
}

if (configured && !anonConfigured) {
  it.skip(
    "communication log RLS integration skipped — set TEST_SUPABASE_ANON_KEY " +
      "from the isolated stack",
    () => {}
  );
}
