import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DROP_OFF_AGREEMENT_ID,
  FIXTURE_CUSTOMER,
  FIXTURE_MOTORCYCLE,
  FIXTURE_PASSWORD,
  FIXTURE_ROLES,
  FIXTURE_USERS,
  FIXTURE_WORK_ORDER,
  JOB_A,
  JOB_B,
  JOB_C,
  PART_A,
  QA_LOCATION,
  QB_LOCATION,
  SERVICE_A,
  SERVICE_B,
  SERVICE_C,
  TIME_CLOCK_ENTRIES,
} from "./ids";

/**
 * Idempotent seed/reset of the synthetic QA shop. Everything is keyed by the
 * fixed UUIDs in ids.ts: seeding upserts on primary keys, reset deletes only
 * those exact rows (children first). Uses the service-role key of the
 * ISOLATED test database — callers must run assertSafeMutationEnvironment()
 * before invoking anything here.
 */

function centsToDollars(cents: number): number {
  return cents / 100;
}

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Synthetic seed needs TEST_SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and " +
        "TEST_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY). " +
        "Run `supabase start` and export the values from `supabase status -o env`."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type DbError = { code?: string; message: string };

function describeError(step: string, error: DbError): Error {
  return new Error(`[seed] ${step} failed: ${error.message} (code ${error.code ?? "?"})`);
}

function isAlreadyExistsAuthError(error: {
  code?: string;
  status?: number;
  message: string;
}): boolean {
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    /already (been )?(registered|exists)/i.test(error.message) ||
    error.status === 422
  );
}

async function seedAuthUsers(supabase: SupabaseClient): Promise<void> {
  for (const role of FIXTURE_ROLES) {
    const user = FIXTURE_USERS[role];
    const { error } = await supabase.auth.admin.createUser({
      id: user.id,
      email: user.email,
      password: FIXTURE_PASSWORD,
      email_confirm: true,
    });

    if (!error) continue;
    if (!isAlreadyExistsAuthError(error)) {
      throw describeError(`auth user ${user.email}`, error);
    }

    // Already seeded: make sure password/confirmation still match the fixture.
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: FIXTURE_PASSWORD,
      email_confirm: true,
    });
    if (updateError) {
      throw new Error(
        `[seed] auth user ${user.email} exists but could not be updated ` +
          `(${updateError.message}). A user with this email but a different ` +
          "id may exist — reset the test database."
      );
    }
  }
}

async function seedTimeClockPunches(supabase: SupabaseClient): Promise<void> {
  // Punches are optional: skip gracefully if the table (or its current
  // shape) is not present in this database.
  const probe = await supabase
    .from("time_clock_entry")
    .select("entry_id, clock_out_at, voided_at")
    .limit(1);

  if (probe.error) {
    console.log(`[seed] skipping time clock punches (${probe.error.message})`);
    return;
  }

  const punches: Array<{ entryId: string; userId: string }> = [
    { entryId: TIME_CLOCK_ENTRIES.techA, userId: FIXTURE_USERS.techA.id },
    { entryId: TIME_CLOCK_ENTRIES.techB, userId: FIXTURE_USERS.techB.id },
    { entryId: TIME_CLOCK_ENTRIES.headTech, userId: FIXTURE_USERS.headTech.id },
  ];

  for (const punch of punches) {
    // The schema allows one open punch per user; keep an existing one.
    const { data: open, error: openError } = await supabase
      .from("time_clock_entry")
      .select("entry_id")
      .eq("user_id", punch.userId)
      .is("clock_out_at", null)
      .is("voided_at", null)
      .limit(1);

    if (openError) throw describeError("time_clock_entry lookup", openError);
    if (open && open.length > 0) continue;

    const { error } = await supabase.from("time_clock_entry").upsert(
      {
        entry_id: punch.entryId,
        user_id: punch.userId,
        location_id: QA_LOCATION.id,
        clock_in_at: new Date().toISOString(),
        clock_out_at: null,
        voided_at: null,
      },
      { onConflict: "entry_id" }
    );
    if (error) throw describeError("time_clock_entry upsert", error);
  }
}

export async function seedSyntheticShop(): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error: locationError } = await supabase.from("location").upsert(
    [
      {
        location_id: QA_LOCATION.id,
        name: QA_LOCATION.name,
        code: QA_LOCATION.code,
        status: "active",
      },
      {
        location_id: QB_LOCATION.id,
        name: QB_LOCATION.name,
        code: QB_LOCATION.code,
        status: "active",
      },
    ],
    { onConflict: "location_id" }
  );
  if (locationError) throw describeError("location upsert", locationError);

  await seedAuthUsers(supabase);

  const nowIso = new Date().toISOString();

  const { error: appUserError } = await supabase.from("app_user").upsert(
    FIXTURE_ROLES.map((role) => {
      const user = FIXTURE_USERS[role];
      return {
        user_id: user.id,
        auth_user_id: user.id,
        first_name: user.firstName,
        last_name: user.lastName,
        email: user.email,
        role: user.appRole,
        status: user.status,
      };
    }),
    { onConflict: "user_id" }
  );
  if (appUserError) throw describeError("app_user upsert", appUserError);

  // Membership in QA only — sessions derive active_location_id from the
  // user's first user_location row, so every fixture user lands in QA.
  const { error: userLocationError } = await supabase.from("user_location").upsert(
    FIXTURE_ROLES.map((role) => ({
      user_id: FIXTURE_USERS[role].id,
      location_id: QA_LOCATION.id,
    })),
    { onConflict: "user_id,location_id" }
  );
  if (userLocationError) {
    throw describeError("user_location upsert", userLocationError);
  }

  const { error: customerError } = await supabase.from("customer").upsert(
    {
      customer_id: FIXTURE_CUSTOMER.id,
      first_name: FIXTURE_CUSTOMER.firstName,
      last_name: FIXTURE_CUSTOMER.lastName,
      email: FIXTURE_CUSTOMER.email,
      phone: FIXTURE_CUSTOMER.phone,
    },
    { onConflict: "customer_id" }
  );
  if (customerError) throw describeError("customer upsert", customerError);

  const { error: motorcycleError } = await supabase.from("motorcycle").upsert(
    {
      motorcycle_id: FIXTURE_MOTORCYCLE.id,
      customer_id: FIXTURE_CUSTOMER.id,
      year: FIXTURE_MOTORCYCLE.year,
      make: FIXTURE_MOTORCYCLE.make,
      model: FIXTURE_MOTORCYCLE.model,
      vin: FIXTURE_MOTORCYCLE.vin,
      colour: FIXTURE_MOTORCYCLE.colour,
    },
    { onConflict: "motorcycle_id" }
  );
  if (motorcycleError) throw describeError("motorcycle upsert", motorcycleError);

  const { error: workOrderError } = await supabase.from("work_order").upsert(
    {
      work_order_id: FIXTURE_WORK_ORDER.id,
      location_id: QA_LOCATION.id,
      motorcycle_id: FIXTURE_MOTORCYCLE.id,
      // Snapshot columns required since migration 017.
      customer_id: FIXTURE_CUSTOMER.id,
      work_order_number: FIXTURE_WORK_ORDER.number,
      status: FIXTURE_WORK_ORDER.status,
      mileage: FIXTURE_WORK_ORDER.mileage,
      mileage_unit: "km",
      created_by_user_id: FIXTURE_USERS.advisor.id,
      // Reset workflow state so re-seeding restores a deterministic baseline.
      primary_technician_id: null,
      opened_at: null,
      quality_checked_at: null,
      quality_checked_by_user_id: null,
      safety_checked_at: null,
      safety_checked_by_user_id: null,
      ready_for_pickup_at: null,
      completed_at: null,
    },
    { onConflict: "work_order_id" }
  );
  if (workOrderError) throw describeError("work_order upsert", workOrderError);

  // Paper drop-off agreement against the template seeded by migration 019.
  const { data: template, error: templateError } = await supabase
    .from("drop_off_agreement_template")
    .select("template_id, version")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (templateError) {
    throw describeError("drop_off_agreement_template lookup", templateError);
  }
  if (!template) {
    throw new Error(
      "[seed] no active drop_off_agreement_template found — run supabase migrations first."
    );
  }

  const { error: agreementError } = await supabase.from("drop_off_agreement").upsert(
    {
      agreement_id: DROP_OFF_AGREEMENT_ID,
      work_order_id: FIXTURE_WORK_ORDER.id,
      template_id: template.template_id,
      template_version: template.version,
      signer_name: `${FIXTURE_CUSTOMER.firstName} ${FIXTURE_CUSTOMER.lastName}`,
      initials: {},
      signature_method: "paper",
      signature_storage_path: null,
      signed_by_user_id: FIXTURE_USERS.advisor.id,
    },
    { onConflict: "agreement_id" }
  );
  if (agreementError) {
    throw describeError("drop_off_agreement upsert", agreementError);
  }

  const services = [
    { fixture: SERVICE_A, priceCents: JOB_A.totalCents },
    { fixture: SERVICE_B, priceCents: JOB_B.totalCents },
    { fixture: SERVICE_C, priceCents: JOB_C.totalCents },
  ];
  const { error: serviceError } = await supabase.from("service").upsert(
    services.map(({ fixture, priceCents }) => ({
      service_id: fixture.id,
      name: fixture.name,
      standard_price: centsToDollars(priceCents),
      estimated_labour: 1,
      active: true,
      category: "QA Synthetic",
    })),
    { onConflict: "service_id" }
  );
  if (serviceError) throw describeError("service upsert", serviceError);

  const approvedFields = {
    approved_by_customer_at: nowIso,
    approval_method: "in_person",
    approval_recorded_by_user_id: FIXTURE_USERS.advisor.id,
  };
  const pendingFields = {
    approved_by_customer_at: null,
    approval_method: null,
    approval_recorded_by_user_id: null,
  };
  const jobs = [
    { job: JOB_A, approval: approvedFields },
    { job: JOB_B, approval: approvedFields },
    { job: JOB_C, approval: pendingFields },
  ];
  const { error: jobError } = await supabase.from("job").upsert(
    jobs.map(({ job, approval }) => ({
      job_id: job.id,
      work_order_id: FIXTURE_WORK_ORDER.id,
      service_id: job.serviceId,
      service_name_snapshot: job.name,
      // Legacy schema stores dollars (numeric); fixtures are integer cents.
      standard_price_snapshot: centsToDollars(job.totalCents),
      estimated_labour_snapshot: 1,
      status: job.status,
      created_by_user_id: FIXTURE_USERS.advisor.id,
      assigned_technician_id: null,
      started_at: null,
      completed_at: null,
      declined_at: null,
      decline_reason: null,
      ...approval,
    })),
    { onConflict: "job_id" }
  );
  if (jobError) throw describeError("job upsert", jobError);

  const { error: partError } = await supabase.from("part").upsert(
    {
      part_id: PART_A.id,
      job_id: PART_A.jobId,
      part_name: PART_A.name,
      quantity: PART_A.quantity,
      status: PART_A.status,
      unit_price: centsToDollars(PART_A.unitPriceCents),
      created_by_user_id: FIXTURE_USERS.advisor.id,
      installed_at: null,
    },
    { onConflict: "part_id" }
  );
  if (partError) throw describeError("part upsert", partError);

  await seedTimeClockPunches(supabase);

  console.log("[seed] synthetic QA shop ready");
}

async function deleteByIds(
  supabase: SupabaseClient,
  table: string,
  column: string,
  ids: readonly string[],
  options: { tolerateMissingTable?: boolean } = {}
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .delete()
    .in(column, [...ids]);
  if (!error) return;
  if (options.tolerateMissingTable) {
    console.log(`[reset] skipping ${table} (${error.message})`);
    return;
  }
  throw new Error(`[reset] delete from ${table} failed: ${error.message}`);
}

export async function resetSyntheticShop(): Promise<void> {
  const supabase = createServiceRoleClient();
  const userIds = FIXTURE_ROLES.map((role) => FIXTURE_USERS[role].id);

  // Children first; only rows whose fixed IDs live in ids.ts are touched.
  await deleteByIds(
    supabase,
    "time_clock_entry",
    "entry_id",
    Object.values(TIME_CLOCK_ENTRIES),
    { tolerateMissingTable: true }
  );
  await deleteByIds(supabase, "part", "part_id", [PART_A.id]);
  await deleteByIds(supabase, "job", "job_id", [JOB_A.id, JOB_B.id, JOB_C.id]);
  await deleteByIds(supabase, "drop_off_agreement", "agreement_id", [
    DROP_OFF_AGREEMENT_ID,
  ]);
  // Cascades the remaining work-order children (timeline events, photos, …).
  await deleteByIds(supabase, "work_order", "work_order_id", [FIXTURE_WORK_ORDER.id]);
  await deleteByIds(supabase, "motorcycle", "motorcycle_id", [FIXTURE_MOTORCYCLE.id]);
  await deleteByIds(supabase, "customer", "customer_id", [FIXTURE_CUSTOMER.id]);
  await deleteByIds(supabase, "service", "service_id", [
    SERVICE_A.id,
    SERVICE_B.id,
    SERVICE_C.id,
  ]);
  await deleteByIds(supabase, "user_location", "user_id", userIds);
  await deleteByIds(supabase, "app_user", "user_id", userIds);

  for (const id of userIds) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error && error.code !== "user_not_found" && error.status !== 404) {
      throw new Error(`[reset] delete auth user ${id} failed: ${error.message}`);
    }
  }

  await deleteByIds(supabase, "location", "location_id", [
    QA_LOCATION.id,
    QB_LOCATION.id,
  ]);

  console.log("[reset] synthetic QA shop removed");
}
