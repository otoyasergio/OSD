import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServiceClient, describeIntegration } from "@/tests/integration/helpers";

/**
 * Backfill reconciliation: dry-run reports without writing, apply maps
 * legacy statuses onto V2 facets, re-running is a no-op, and parity holds.
 */

const admin = process.env.TEST_SUPABASE_URL ? createServiceClient() : null;

const ids = {
  location: randomUUID(),
  customer: randomUUID(),
  motorcycle: randomUUID(),
  workOrder: randomUUID(),
  jobApproved: randomUUID(),
  jobParts: randomUUID(),
  service: randomUUID(),
};

describeIntegration("workflow_v2 backfill reconciliation (isolated db)", () => {
  beforeAll(async () => {
    if (!admin) return;
    await admin.from("location").upsert({
      location_id: ids.location,
      name: "Backfill IT",
      code: `BI${ids.location.slice(0, 4)}`,
    });
    await admin.from("customer").upsert({
      customer_id: ids.customer,
      first_name: "Backfill",
      last_name: "IT",
      email: `it-backfill-${ids.customer.slice(0, 8)}@otomoto.invalid`,
    });
    await admin.from("motorcycle").upsert({
      motorcycle_id: ids.motorcycle,
      customer_id: ids.customer,
      year: 2019,
      make: "Test",
      model: "Backfill",
    });
    await admin.from("work_order").upsert({
      work_order_id: ids.workOrder,
      motorcycle_id: ids.motorcycle,
      location_id: ids.location,
      work_order_number: `WO-BI-${ids.workOrder.slice(0, 8)}`,
      status: "waiting_for_parts",
    });
    await admin.from("service").upsert({
      service_id: ids.service,
      name: `Backfill IT Service ${ids.service.slice(0, 8)}`,
      standard_price: 80,
      estimated_labour: 0.5,
    });
    for (const [jobId, status] of [
      [ids.jobApproved, "approved"],
      [ids.jobParts, "waiting_for_parts"],
    ] as const) {
      await admin.from("job").upsert({
        job_id: jobId,
        work_order_id: ids.workOrder,
        service_id: ids.service,
        service_name_snapshot: `Backfill ${status}`,
        standard_price_snapshot: 80,
        estimated_labour_snapshot: 0.5,
        status,
      });
    }
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("work_order").delete().eq("work_order_id", ids.workOrder);
    await admin.from("motorcycle").delete().eq("motorcycle_id", ids.motorcycle);
    await admin.from("customer").delete().eq("customer_id", ids.customer);
    await admin.from("service").delete().eq("service_id", ids.service);
    await admin.from("location").delete().eq("location_id", ids.location);
  });

  it("dry-runs, applies, and re-applies idempotently with legacy parity", async () => {
    if (!admin) return;

    // Dry run: reports but does not write facets for this WO.
    const { data: dryRun, error: dryError } = await admin.rpc(
      "workflow_v2_backfill_batch",
      { p_limit: 10_000, p_apply: false }
    );
    expect(dryError).toBeNull();
    expect((dryRun as { apply: boolean }).apply).toBe(false);

    const { data: untouched } = await admin
      .from("work_order")
      .select("lifecycle_state")
      .eq("work_order_id", ids.workOrder)
      .single();
    expect(untouched?.lifecycle_state).toBeNull();

    // Apply until drained.
    let guard = 0;
    for (;;) {
      const { data, error } = await admin.rpc("workflow_v2_backfill_batch", {
        p_limit: 500,
        p_apply: true,
      });
      expect(error).toBeNull();
      if ((data as { work_orders_processed: number }).work_orders_processed === 0) {
        break;
      }
      guard += 1;
      expect(guard).toBeLessThan(100);
    }

    const { data: migrated } = await admin
      .from("work_order")
      .select("lifecycle_state")
      .eq("work_order_id", ids.workOrder)
      .single();
    expect(migrated?.lifecycle_state).toBe("active");

    const { data: jobs } = await admin
      .from("job")
      .select("job_id, status, work_state, pricing_mode")
      .eq("work_order_id", ids.workOrder);
    const byId = new Map((jobs ?? []).map((row) => [row.job_id, row]));
    expect(byId.get(ids.jobApproved)?.work_state).toBe("planned");
    expect(byId.get(ids.jobApproved)?.pricing_mode).toBe("fixed_package");
    expect(byId.get(ids.jobParts)?.work_state).toBe("planned");

    const { count: partsBlockers } = await admin
      .from("job_blocker")
      .select("job_blocker_id", { count: "exact", head: true })
      .eq("job_id", ids.jobParts)
      .eq("kind", "parts")
      .is("cleared_at", null);
    expect(partsBlockers).toBe(1);

    // Re-run is a no-op for this WO and duplicates nothing.
    const { data: rerun } = await admin.rpc("workflow_v2_backfill_batch", {
      p_limit: 500,
      p_apply: true,
    });
    expect((rerun as { work_orders_processed: number }).work_orders_processed).toBe(0);

    const { count: blockersAfter } = await admin
      .from("job_blocker")
      .select("job_blocker_id", { count: "exact", head: true })
      .eq("job_id", ids.jobParts)
      .is("cleared_at", null);
    expect(blockersAfter).toBe(1);

    const { count: laborPlans } = await admin
      .from("job_labor_plan")
      .select("job_labor_plan_id", { count: "exact", head: true })
      .in("job_id", [ids.jobApproved, ids.jobParts]);
    expect(laborPlans).toBe(2);
  }, 120_000);
});
