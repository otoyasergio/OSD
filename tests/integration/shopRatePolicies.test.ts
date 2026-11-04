import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAnonClient,
  createServiceClient,
  integrationConfigured,
} from "@/tests/integration/helpers";

/**
 * Column-level guard on location.hourly_rate against an isolated database:
 * only an owner session may change the rate, while other staff keep editing
 * the rest of the row. Never reads NEXT_PUBLIC_* — those may point at production.
 */

const configured = integrationConfigured();
const anonConfigured = Boolean(process.env.TEST_SUPABASE_ANON_KEY?.trim());
const suiteReady = configured && anonConfigured;
const describeShopRate = suiteReady ? describe : describe.skip;
const admin = suiteReady ? createServiceClient() : null;
const PASSWORD = "Synthetic-Shop-Rate-2026!";

const ids = {
  location: randomUUID(),
  owner: randomUUID(),
  manager: randomUUID(),
  tech: randomUUID(),
};

const emails = {
  owner: `it-rate-owner-${ids.owner.slice(0, 8)}@otomoto.invalid`,
  manager: `it-rate-manager-${ids.manager.slice(0, 8)}@otomoto.invalid`,
  tech: `it-rate-tech-${ids.tech.slice(0, 8)}@otomoto.invalid`,
};

function requireAdmin(): SupabaseClient {
  if (!admin) {
    throw new Error(
      "shop rate policy suite missing isolated TEST_SUPABASE service client"
    );
  }
  return admin;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in ${email} failed: ${error.message}`);
  return client;
}

async function ensureAuthUser(userId: string, email: string): Promise<void> {
  const service = requireAdmin();
  await service.auth.admin.deleteUser(userId);
  const created = await service.auth.admin.createUser({
    id: userId,
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error) throw new Error(`auth user ${email}: ${created.error.message}`);
}

async function currentRate(): Promise<number> {
  const { data, error } = await requireAdmin()
    .from("location")
    .select("hourly_rate")
    .eq("location_id", ids.location)
    .single();
  if (error) throw new Error(error.message);
  return Number(data.hourly_rate);
}

async function cleanupFixtures(): Promise<void> {
  const service = requireAdmin();
  const users = [ids.owner, ids.manager, ids.tech];
  await service.from("audit_log").delete().eq("location_id", ids.location);
  await service.from("user_location").delete().in("user_id", users);
  await service.from("app_user").delete().in("user_id", users);
  await service.from("location").delete().eq("location_id", ids.location);
  for (const userId of users) {
    await service.auth.admin.deleteUser(userId);
  }
}

describeShopRate("location hourly rate guard (isolated db)", () => {
  beforeAll(async () => {
    const service = requireAdmin();
    await cleanupFixtures();
    const { error: locationError } = await service.from("location").upsert({
      location_id: ids.location,
      name: "Shop Rate IT",
      code: `SR${ids.location.slice(0, 4)}`,
      status: "active",
      hourly_rate: 156,
    });
    if (locationError) throw new Error(locationError.message);

    const staff: Array<[string, string, string, string]> = [
      [ids.owner, emails.owner, "Owner", "owner"],
      [ids.manager, emails.manager, "Manager", "manager"],
      [ids.tech, emails.tech, "Tech", "technician"],
    ];
    for (const [userId, email, first, role] of staff) {
      await ensureAuthUser(userId, email);
      const { error } = await service.from("app_user").upsert({
        user_id: userId,
        auth_user_id: userId,
        first_name: first,
        last_name: "RateIT",
        email,
        role,
        status: "active",
      });
      if (error) throw new Error(`app_user ${email}: ${error.message}`);
    }
    const { error: membershipError } = await service
      .from("user_location")
      .upsert(staff.map(([user_id]) => ({ user_id, location_id: ids.location })));
    if (membershipError) throw new Error(membershipError.message);
  });

  afterAll(async () => {
    if (!admin) return;
    await cleanupFixtures();
  });

  it("rejects a rate change from a manager or technician and leaves the rate alone", async () => {
    for (const email of [emails.manager, emails.tech]) {
      const staff = await signIn(email);
      try {
        const result = await staff
          .from("location")
          .update({ hourly_rate: 999 })
          .eq("location_id", ids.location)
          .select("hourly_rate");
        expect(result.error?.message ?? "").toContain("SHOP_RATE_WRITE_FORBIDDEN");
        expect(await currentRate()).toBe(156);
      } finally {
        await staff.auth.signOut();
      }
    }
  });

  it("still lets a manager edit other location fields", async () => {
    const manager = await signIn(emails.manager);
    try {
      const result = await manager
        .from("location")
        .update({ name: "Shop Rate IT renamed" })
        .eq("location_id", ids.location)
        .select("name, hourly_rate")
        .single();
      expect(result.error).toBeNull();
      expect(result.data?.name).toBe("Shop Rate IT renamed");
      expect(Number(result.data?.hourly_rate)).toBe(156);
    } finally {
      await manager.auth.signOut();
    }
  });

  it("lets the owner change the rate", async () => {
    const owner = await signIn(emails.owner);
    try {
      const result = await owner
        .from("location")
        .update({ hourly_rate: 180 })
        .eq("location_id", ids.location)
        .select("hourly_rate")
        .single();
      expect(result.error).toBeNull();
      expect(Number(result.data?.hourly_rate)).toBe(180);
      expect(await currentRate()).toBe(180);
    } finally {
      await owner.auth.signOut();
    }
  });

  it("does not guard service-role sessions", async () => {
    const result = await requireAdmin()
      .from("location")
      .update({ hourly_rate: 156 })
      .eq("location_id", ids.location)
      .select("hourly_rate")
      .single();
    expect(result.error).toBeNull();
    expect(Number(result.data?.hourly_rate)).toBe(156);
  });
});
