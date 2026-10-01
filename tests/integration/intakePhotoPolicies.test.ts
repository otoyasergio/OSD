import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAnonClient,
  createServiceClient,
  integrationConfigured,
} from "@/tests/integration/helpers";

/**
 * Real RLS / RPC / checkout-trigger coverage against an isolated database.
 * Never reads NEXT_PUBLIC_* — those may point at production.
 */

const configured = integrationConfigured();
const anonConfigured = Boolean(process.env.TEST_SUPABASE_ANON_KEY?.trim());
const suiteReady = configured && anonConfigured;
const describePhotoPolicies = suiteReady ? describe : describe.skip;
const admin = suiteReady ? createServiceClient() : null;
const PASSWORD = "Synthetic-Photo-Policy-2026!";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

const ids = {
  locationA: randomUUID(),
  locationB: randomUUID(),
  tech: randomUUID(),
  advisor: randomUUID(),
  owner: randomUUID(),
  manager: randomUUID(),
  foreign: randomUUID(),
  customer: randomUUID(),
  motorcycle: randomUUID(),
  workOrder: randomUUID(),
  checkoutWorkOrder: randomUUID(),
  overrideWorkOrder: randomUUID(),
  service: randomUUID(),
  job: randomUUID(),
  photoTech: randomUUID(),
  photoAdvisor: randomUUID(),
  photoOwner: randomUUID(),
  replayPhoto: randomUUID(),
  replayClient: randomUUID(),
};

const emails = {
  tech: `it-photo-tech-${ids.tech.slice(0, 8)}@otomoto.invalid`,
  advisor: `it-photo-advisor-${ids.advisor.slice(0, 8)}@otomoto.invalid`,
  owner: `it-photo-owner-${ids.owner.slice(0, 8)}@otomoto.invalid`,
  manager: `it-photo-manager-${ids.manager.slice(0, 8)}@otomoto.invalid`,
  foreign: `it-photo-foreign-${ids.foreign.slice(0, 8)}@otomoto.invalid`,
};

const objectPaths = {
  tech: `${ids.workOrder}/front/${ids.photoTech}.jpg`,
  advisor: `${ids.workOrder}/rear/${ids.photoAdvisor}.jpg`,
  owner: `${ids.workOrder}/vin/${ids.photoOwner}.jpg`,
  replay: `${ids.workOrder}/odometer/${ids.replayPhoto}.jpg`,
  malformed: `not-a-uuid/front/${ids.photoTech}.jpg`,
  foreign: `${ids.workOrder}/damage/${randomUUID()}.jpg`,
};

function errorText(error: { message?: string; code?: string } | null): string {
  return `${error?.code ?? ""} ${error?.message ?? ""}`;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in ${email} failed: ${error.message}`);
  return client;
}

function requireAdmin(): SupabaseClient {
  if (!admin) {
    throw new Error(
      "intake photo policy suite missing isolated TEST_SUPABASE service client"
    );
  }
  return admin;
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

async function cleanupFixtures(): Promise<void> {
  const service = requireAdmin();
  const photoIds = [ids.photoTech, ids.photoAdvisor, ids.photoOwner, ids.replayPhoto];
  const workOrders = [ids.workOrder, ids.checkoutWorkOrder, ids.overrideWorkOrder];
  await service.storage.from("intake-photos").remove(Object.values(objectPaths));
  await service.from("intake_photo").delete().in("photo_id", photoIds);
  await service.from("intake_photo").delete().in("work_order_id", workOrders);
  await service.from("audit_log").delete().in("entity_id", photoIds);
  await service.from("job").delete().eq("job_id", ids.job);
  await service.from("work_order").delete().in("work_order_id", workOrders);
  await service.from("motorcycle").delete().eq("motorcycle_id", ids.motorcycle);
  await service.from("customer").delete().eq("customer_id", ids.customer);
  await service.from("service").delete().eq("service_id", ids.service);
  await service
    .from("user_location")
    .delete()
    .in("user_id", [ids.tech, ids.advisor, ids.owner, ids.manager, ids.foreign]);
  await service
    .from("app_user")
    .delete()
    .in("user_id", [ids.tech, ids.advisor, ids.owner, ids.manager, ids.foreign]);
  await service
    .from("location")
    .delete()
    .in("location_id", [ids.locationA, ids.locationB]);
  for (const userId of [ids.tech, ids.advisor, ids.owner, ids.manager, ids.foreign]) {
    await service.auth.admin.deleteUser(userId);
  }
}

describePhotoPolicies("intake photo policies (isolated db)", () => {
  beforeAll(async () => {
    const admin = requireAdmin();
    await cleanupFixtures();
    await admin.from("location").upsert([
      {
        location_id: ids.locationA,
        name: "Photo Policy A",
        code: `PA${ids.locationA.slice(0, 4)}`,
        status: "active",
      },
      {
        location_id: ids.locationB,
        name: "Photo Policy B",
        code: `PB${ids.locationB.slice(0, 4)}`,
        status: "active",
      },
    ]);
    const staff: Array<[string, string, string, string]> = [
      [ids.tech, emails.tech, "Tech", "technician"],
      [ids.advisor, emails.advisor, "Advisor", "service_advisor"],
      [ids.owner, emails.owner, "Owner", "owner"],
      [ids.manager, emails.manager, "Manager", "manager"],
      [ids.foreign, emails.foreign, "Foreign", "owner"],
    ];
    for (const [userId, email, first, role] of staff) {
      await ensureAuthUser(userId, email);
      const { error } = await admin.from("app_user").upsert({
        user_id: userId,
        auth_user_id: userId,
        first_name: first,
        last_name: "PhotoIT",
        email,
        role,
        status: "active",
      });
      if (error) throw new Error(`app_user ${email}: ${error.message}`);
    }
    const memberships = [
      [ids.tech, ids.locationA],
      [ids.advisor, ids.locationA],
      [ids.owner, ids.locationA],
      [ids.manager, ids.locationA],
      [ids.foreign, ids.locationB],
    ];
    const { error: membershipError } = await admin
      .from("user_location")
      .upsert(memberships.map(([user_id, location_id]) => ({ user_id, location_id })));
    if (membershipError) throw new Error(membershipError.message);
    await admin.from("customer").upsert({
      customer_id: ids.customer,
      first_name: "Photo",
      last_name: "Customer",
      email: `it-photo-customer-${ids.customer.slice(0, 8)}@otomoto.invalid`,
    });
    await admin.from("motorcycle").upsert({
      motorcycle_id: ids.motorcycle,
      customer_id: ids.customer,
      year: 2024,
      make: "Test",
      model: "Policy",
    });
    await admin.from("work_order").upsert({
      work_order_id: ids.workOrder,
      motorcycle_id: ids.motorcycle,
      customer_id: ids.customer,
      location_id: ids.locationA,
      work_order_number: `WO-PH-${ids.workOrder.slice(0, 8)}`,
      status: "open",
      primary_technician_id: ids.tech,
      created_by_user_id: ids.advisor,
    });
    await admin.from("work_order").upsert({
      work_order_id: ids.checkoutWorkOrder,
      motorcycle_id: ids.motorcycle,
      customer_id: ids.customer,
      location_id: ids.locationA,
      work_order_number: `WO-CK-${ids.checkoutWorkOrder.slice(0, 8)}`,
      status: "open",
      checkout_evidence_required: true,
    });
    await admin.from("work_order").upsert({
      work_order_id: ids.overrideWorkOrder,
      motorcycle_id: ids.motorcycle,
      customer_id: ids.customer,
      location_id: ids.locationA,
      work_order_number: `WO-OV-${ids.overrideWorkOrder.slice(0, 8)}`,
      status: "open",
      checkout_evidence_required: true,
    });
    await admin.from("service").upsert({
      service_id: ids.service,
      name: `Photo IT Service ${ids.service.slice(0, 8)}`,
      standard_price: 1,
      estimated_labour: 1,
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  it("lets assigned technician and advisor select/insert but cannot update or delete the object or DELETE the row", async () => {
    const admin = requireAdmin();
    const tech = await signIn(emails.tech);
    try {
      const insertRow = await tech.from("intake_photo").insert({
        photo_id: ids.photoTech,
        work_order_id: ids.workOrder,
        storage_path: objectPaths.tech,
        category: "front",
        notes: "tech insert",
      });
      expect(insertRow.error).toBeNull();
      const select = await tech
        .from("intake_photo")
        .select("photo_id")
        .eq("photo_id", ids.photoTech)
        .maybeSingle();
      expect(select.error).toBeNull();
      expect(select.data?.photo_id).toBe(ids.photoTech);

      const upload = await tech.storage
        .from("intake-photos")
        .upload(objectPaths.tech, JPEG, { contentType: "image/jpeg", upsert: false });
      expect(upload.error).toBeNull();

      const updateRow = await tech
        .from("intake_photo")
        .update({ notes: "should fail" })
        .eq("photo_id", ids.photoTech)
        .select("photo_id");
      expect(updateRow.data ?? []).toEqual([]);

      const updateObject = await tech.storage
        .from("intake-photos")
        .update(objectPaths.tech, JPEG, { contentType: "image/jpeg" });
      expect(updateObject.error).not.toBeNull();

      const deleteObject = await tech.storage
        .from("intake-photos")
        .remove([objectPaths.tech]);
      const deletedObjects = deleteObject.data ?? [];
      expect(deletedObjects.length).toBe(0);

      const deleteRow = await tech
        .from("intake_photo")
        .delete()
        .eq("photo_id", ids.photoTech)
        .select("photo_id");
      expect(deleteRow.data ?? []).toEqual([]);
      const stillThere = await admin
        .from("intake_photo")
        .select("photo_id")
        .eq("photo_id", ids.photoTech)
        .maybeSingle();
      expect(stillThere.data?.photo_id).toBe(ids.photoTech);
    } finally {
      await tech.auth.signOut();
    }

    const advisor = await signIn(emails.advisor);
    try {
      const insertRow = await advisor.from("intake_photo").insert({
        photo_id: ids.photoAdvisor,
        work_order_id: ids.workOrder,
        storage_path: objectPaths.advisor,
        category: "rear",
      });
      expect(insertRow.error).toBeNull();
      const upload = await advisor.storage
        .from("intake-photos")
        .upload(objectPaths.advisor, JPEG, { contentType: "image/jpeg", upsert: false });
      expect(upload.error).toBeNull();
      const deleteRow = await advisor
        .from("intake_photo")
        .delete()
        .eq("photo_id", ids.photoAdvisor)
        .select("photo_id");
      expect(deleteRow.data ?? []).toEqual([]);
    } finally {
      await advisor.auth.signOut();
    }
  });

  it("lets assigned owner and manager delete the row and object", async () => {
    const admin = requireAdmin();
    const owner = await signIn(emails.owner);
    try {
      const insertRow = await owner.from("intake_photo").insert({
        photo_id: ids.photoOwner,
        work_order_id: ids.workOrder,
        storage_path: objectPaths.owner,
        category: "vin",
      });
      expect(insertRow.error).toBeNull();
      const upload = await owner.storage
        .from("intake-photos")
        .upload(objectPaths.owner, JPEG, { contentType: "image/jpeg", upsert: false });
      expect(upload.error).toBeNull();
      const deleteObject = await owner.storage
        .from("intake-photos")
        .remove([objectPaths.owner]);
      expect(deleteObject.error).toBeNull();
      const deleteRow = await owner
        .from("intake_photo")
        .delete()
        .eq("photo_id", ids.photoOwner)
        .select("photo_id");
      expect(deleteRow.error).toBeNull();
      expect(deleteRow.data?.[0]?.photo_id).toBe(ids.photoOwner);
    } finally {
      await owner.auth.signOut();
    }

    const manager = await signIn(emails.manager);
    try {
      const reinsert = await admin.from("intake_photo").insert({
        photo_id: ids.photoOwner,
        work_order_id: ids.workOrder,
        storage_path: objectPaths.owner,
        category: "vin",
      });
      expect(reinsert.error).toBeNull();
      await admin.storage
        .from("intake-photos")
        .upload(objectPaths.owner, JPEG, { contentType: "image/jpeg", upsert: true });
      const deleteRow = await manager
        .from("intake_photo")
        .delete()
        .eq("photo_id", ids.photoOwner)
        .select("photo_id");
      expect(deleteRow.error).toBeNull();
      expect(deleteRow.data?.[0]?.photo_id).toBe(ids.photoOwner);
      const deleteObject = await manager.storage
        .from("intake-photos")
        .remove([objectPaths.owner]);
      expect(deleteObject.error).toBeNull();
    } finally {
      await manager.auth.signOut();
    }
  });

  it("blocks cross-location staff from selecting, inserting, or deleting row or object", async () => {
    requireAdmin();
    const foreign = await signIn(emails.foreign);
    try {
      const select = await foreign
        .from("intake_photo")
        .select("photo_id")
        .eq("work_order_id", ids.workOrder);
      expect(select.error).toBeNull();
      expect(select.data ?? []).toEqual([]);

      const insert = await foreign.from("intake_photo").insert({
        photo_id: randomUUID(),
        work_order_id: ids.workOrder,
        storage_path: `${ids.workOrder}/damage/${randomUUID()}.jpg`,
        category: "damage",
      });
      expect(insert.error).not.toBeNull();

      const upload = await foreign.storage
        .from("intake-photos")
        .upload(objectPaths.foreign, JPEG, {
          contentType: "image/jpeg",
          upsert: false,
        });
      expect(upload.error).not.toBeNull();
      expect(errorText(upload.error)).not.toMatch(
        /already exists|duplicate|resource already|23505/i
      );
      expect(errorText(upload.error)).toMatch(
        /policy|row-level|unauthorized|403|denied|security|rls|violat/i
      );

      const remove = await foreign.storage
        .from("intake-photos")
        .remove([objectPaths.tech]);
      expect((remove.data ?? []).length).toBe(0);

      const deleteRow = await foreign
        .from("intake_photo")
        .delete()
        .eq("photo_id", ids.photoTech)
        .select("photo_id");
      expect(deleteRow.data ?? []).toEqual([]);
    } finally {
      await foreign.auth.signOut();
    }
  });

  it("fails closed on malformed object paths without a database cast error", async () => {
    const admin = requireAdmin();
    const { data, error } = await admin.rpc("intake_photo_object_in_user_locations", {
      object_name: objectPaths.malformed,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
    expect(errorText(error)).not.toMatch(/invalid input syntax for type uuid/i);

    const tech = await signIn(emails.tech);
    try {
      const upload = await tech.storage
        .from("intake-photos")
        .upload(objectPaths.malformed, JPEG, {
          contentType: "image/jpeg",
          upsert: false,
        });
      expect(upload.error).not.toBeNull();
      expect(errorText(upload.error)).not.toMatch(/invalid input syntax for type uuid/i);
    } finally {
      await tech.auth.signOut();
    }
  });

  it("replays client_upload_id through the real RPC as one row, event, and audit", async () => {
    const admin = requireAdmin();
    const tech = await signIn(emails.tech);
    const payload = {
      p_photo_id: ids.replayPhoto,
      p_work_order_id: ids.workOrder,
      p_storage_path: objectPaths.replay,
      p_thumb_storage_path: null,
      p_category: "odometer",
      p_notes: "replay",
      p_inspection_result_id: null,
      p_job_id: null,
      p_client_upload_id: ids.replayClient,
      p_content_type: "image/jpeg",
      p_byte_size: 2,
      p_pixel_width: 1,
      p_pixel_height: 1,
    };
    try {
      const first = await tech.rpc("create_intake_photo_with_event", payload);
      expect(first.error).toBeNull();
      const second = await tech.rpc("create_intake_photo_with_event", {
        ...payload,
        p_photo_id: randomUUID(),
        p_storage_path: `${ids.workOrder}/odometer/${randomUUID()}.jpg`,
      });
      if (second.error) {
        expect(errorText(second.error)).toMatch(/duplicate|unique|23505/i);
      }
      const { count: photos } = await admin
        .from("intake_photo")
        .select("photo_id", { count: "exact", head: true })
        .eq("client_upload_id", ids.replayClient);
      const { count: events } = await admin
        .from("timeline_event")
        .select("timeline_event_id", { count: "exact", head: true })
        .eq("entity_id", ids.replayPhoto);
      const { count: audits } = await admin
        .from("audit_log")
        .select("audit_log_id", { count: "exact", head: true })
        .eq("entity_id", ids.replayPhoto);
      expect(photos).toBe(1);
      expect(events).toBe(1);
      expect(audits).toBe(1);
    } finally {
      await tech.auth.signOut();
    }
  });

  it("blocks ready/completed and same-update required=false until five photos or owner override", async () => {
    const admin = requireAdmin();
    const ready = await admin
      .from("work_order")
      .update({ status: "ready_for_pickup" })
      .eq("work_order_id", ids.checkoutWorkOrder)
      .select("work_order_id");
    expect(errorText(ready.error)).toMatch(/CHECKOUT_EVIDENCE_REQUIRED/);

    const completed = await admin
      .from("work_order")
      .update({ status: "completed" })
      .eq("work_order_id", ids.checkoutWorkOrder)
      .select("work_order_id");
    expect(errorText(completed.error)).toMatch(/CHECKOUT_EVIDENCE_REQUIRED/);

    const flipRequired = await admin
      .from("work_order")
      .update({
        status: "ready_for_pickup",
        checkout_evidence_required: false,
      })
      .eq("work_order_id", ids.checkoutWorkOrder)
      .select("work_order_id");
    expect(errorText(flipRequired.error)).toMatch(/CHECKOUT_EVIDENCE_REQUIRED_IMMUTABLE/);

    const categories = [
      "checkout_front",
      "checkout_rear",
      "checkout_left_side",
      "checkout_right_side",
      "checkout_odometer",
    ];
    for (const category of categories) {
      const photoId = randomUUID();
      const { error } = await admin.from("intake_photo").insert({
        photo_id: photoId,
        work_order_id: ids.checkoutWorkOrder,
        storage_path: `${ids.checkoutWorkOrder}/${category}/${photoId}.jpg`,
        category,
      });
      expect(error).toBeNull();
    }
    const covered = await admin
      .from("work_order")
      .update({ status: "ready_for_pickup" })
      .eq("work_order_id", ids.checkoutWorkOrder)
      .select("status")
      .single();
    expect(covered.error).toBeNull();
    expect(covered.data?.status).toBe("ready_for_pickup");

    const owner = await signIn(emails.owner);
    try {
      const override = await owner
        .from("work_order")
        .update({ checkout_evidence_override_reason: "Camera failed in the rain." })
        .eq("work_order_id", ids.overrideWorkOrder)
        .select("checkout_evidence_override_reason, checkout_evidence_override_at")
        .single();
      expect(override.error).toBeNull();
      expect(override.data?.checkout_evidence_override_reason).toMatch(/Camera failed/);
      expect(override.data?.checkout_evidence_override_at).toBeTruthy();

      const readyOverride = await owner
        .from("work_order")
        .update({ status: "ready_for_pickup" })
        .eq("work_order_id", ids.overrideWorkOrder)
        .select("status")
        .single();
      expect(readyOverride.error).toBeNull();
      expect(readyOverride.data?.status).toBe("ready_for_pickup");

      const completedOverride = await owner
        .from("work_order")
        .update({ status: "completed" })
        .eq("work_order_id", ids.overrideWorkOrder)
        .select("status")
        .single();
      expect(completedOverride.error).toBeNull();
      expect(completedOverride.data?.status).toBe("completed");
    } finally {
      await owner.auth.signOut();
    }
  });

  it("rejects non-owner override create/change/clear and clears via validated reopen RPC", async () => {
    const admin = requireAdmin();
    const owner = await signIn(emails.owner);
    try {
      const seeded = await owner
        .from("work_order")
        .update({ checkout_evidence_override_reason: "Owner override for clear tests." })
        .eq("work_order_id", ids.overrideWorkOrder)
        .select("checkout_evidence_override_at")
        .single();
      expect(seeded.error).toBeNull();
      expect(seeded.data?.checkout_evidence_override_at).toBeTruthy();
    } finally {
      await owner.auth.signOut();
    }

    const tech = await signIn(emails.tech);
    try {
      const create = await tech
        .from("work_order")
        .update({ checkout_evidence_override_reason: "tech should not override" })
        .eq("work_order_id", ids.checkoutWorkOrder)
        .select("work_order_id");
      expect(errorText(create.error)).toMatch(/CHECKOUT_EVIDENCE_OVERRIDE_FORBIDDEN/);

      const change = await tech
        .from("work_order")
        .update({ checkout_evidence_override_reason: "changed by tech" })
        .eq("work_order_id", ids.overrideWorkOrder)
        .select("work_order_id");
      expect(errorText(change.error)).toMatch(/CHECKOUT_EVIDENCE_OVERRIDE_FORBIDDEN/);

      const clear = await tech
        .from("work_order")
        .update({
          checkout_evidence_override_at: null,
          checkout_evidence_override_by_user_id: null,
          checkout_evidence_override_reason: null,
        })
        .eq("work_order_id", ids.overrideWorkOrder)
        .select("work_order_id");
      expect(errorText(clear.error)).toMatch(/CHECKOUT_EVIDENCE_OVERRIDE_FORBIDDEN/);
    } finally {
      await tech.auth.signOut();
    }

    const { error: jobError } = await admin.from("job").insert({
      job_id: ids.job,
      work_order_id: ids.overrideWorkOrder,
      service_id: ids.service,
      service_name_snapshot: "Recommendation reopen",
      standard_price_snapshot: 1,
      estimated_labour_snapshot: 1,
      status: "approved",
      origin: "recommendation",
    });
    expect(jobError).toBeNull();

    const advisor = await signIn(emails.advisor);
    try {
      const reopen = await advisor.rpc("reopen_work_order_for_recommendation_work", {
        p_work_order_id: ids.overrideWorkOrder,
      });
      expect(reopen.error).toBeNull();
      const row = await admin
        .from("work_order")
        .select(
          "checkout_evidence_override_at, checkout_evidence_override_by_user_id, checkout_evidence_override_reason"
        )
        .eq("work_order_id", ids.overrideWorkOrder)
        .single();
      expect(row.data?.checkout_evidence_override_at).toBeNull();
      expect(row.data?.checkout_evidence_override_by_user_id).toBeNull();
      expect(row.data?.checkout_evidence_override_reason).toBeNull();
    } finally {
      await advisor.auth.signOut();
    }
  });
});

if (!integrationConfigured()) {
  it.skip("intake photo policy integration skipped — set isolated TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY (never NEXT_PUBLIC_* / production)", () => {});
}

if (integrationConfigured() && !process.env.TEST_SUPABASE_ANON_KEY) {
  it.skip("intake photo RLS cases skipped — set TEST_SUPABASE_ANON_KEY from isolated supabase status (never NEXT_PUBLIC_*)", () => {});
}
