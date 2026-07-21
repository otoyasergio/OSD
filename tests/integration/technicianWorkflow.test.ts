import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServiceClient, describeIntegration } from "@/tests/integration/helpers";

/**
 * Floor command integration tests: pull/park/complete + QC against the
 * transactional RPCs on an isolated database.
 */

const admin = process.env.TEST_SUPABASE_URL ? createServiceClient() : null;

const ids = {
  location: randomUUID(),
  techA: randomUUID(),
  techB: randomUUID(),
  customer: randomUUID(),
  motorcycle: randomUUID(),
  workOrder: randomUUID(),
  jobA: randomUUID(),
  jobB: randomUUID(),
  service: randomUUID(),
};

describeIntegration("workflow_v2 floor commands (isolated db)", () => {
  beforeAll(async () => {
    if (!admin) return;
    await admin.from("location").upsert({
      location_id: ids.location,
      name: "Floor IT",
      code: `FI${ids.location.slice(0, 4)}`,
    });
    for (const [userId, first, role] of [
      [ids.techA, "TechA", "technician"],
      [ids.techB, "TechB", "technician"],
    ] as const) {
      await admin.from("app_user").upsert({
        user_id: userId,
        first_name: first,
        last_name: "IT",
        email: `it-${first.toLowerCase()}-${userId.slice(0, 8)}@otomoto.invalid`,
        role,
        status: "active",
      });
    }
    await admin.from("customer").upsert({
      customer_id: ids.customer,
      first_name: "Floor",
      last_name: "Customer",
      email: `it-floor-${ids.customer.slice(0, 8)}@otomoto.invalid`,
    });
    await admin.from("motorcycle").upsert({
      motorcycle_id: ids.motorcycle,
      customer_id: ids.customer,
      year: 2023,
      make: "Test",
      model: "Floor",
    });
    await admin.from("work_order").upsert({
      work_order_id: ids.workOrder,
      motorcycle_id: ids.motorcycle,
      location_id: ids.location,
      work_order_number: `WO-FL-${ids.workOrder.slice(0, 8)}`,
      status: "ready_for_technician",
    });
    await admin.from("service").upsert({
      service_id: ids.service,
      name: `Floor IT Service ${ids.service.slice(0, 8)}`,
      standard_price: 100,
      estimated_labour: 1,
    });
    for (const [jobId, name] of [
      [ids.jobA, "Floor job A"],
      [ids.jobB, "Floor job B"],
    ] as const) {
      await admin.from("job").upsert({
        job_id: jobId,
        work_order_id: ids.workOrder,
        service_id: ids.service,
        service_name_snapshot: name,
        standard_price_snapshot: 100,
        estimated_labour_snapshot: 1,
        status: "ready_to_start",
        assigned_technician_id: ids.techA,
      });
    }
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("time_clock_entry").delete().eq("user_id", ids.techA);
    await admin.from("time_clock_entry").delete().eq("user_id", ids.techB);
    await admin.from("work_order").delete().eq("work_order_id", ids.workOrder);
    await admin.from("motorcycle").delete().eq("motorcycle_id", ids.motorcycle);
    await admin.from("customer").delete().eq("customer_id", ids.customer);
    await admin.from("service").delete().eq("service_id", ids.service);
    await admin.from("app_user").delete().in("user_id", [ids.techA, ids.techB]);
    await admin.from("location").delete().eq("location_id", ids.location);
  });

  it("enforces attendance, swaps atomically, gates completion, and excludes visit workers from QC", async () => {
    if (!admin) return;

    // Pull without attendance fails and leaves no timer.
    const { error: noClockError } = await admin.rpc("workflow_v2_pull_job_onto_bench", {
      p_job_id: ids.jobA,
      p_actor_user_id: ids.techA,
    });
    expect(noClockError?.message ?? "").toContain("NOT_CLOCKED_IN_FOR_JOB");
    const { count: timersAfterFail } = await admin
      .from("job_time_entry")
      .select("job_time_entry_id", { count: "exact", head: true })
      .eq("user_id", ids.techA);
    expect(timersAfterFail).toBe(0);

    // Clock in, pull succeeds and opens exactly one timer.
    await admin.from("time_clock_entry").insert({
      user_id: ids.techA,
      location_id: ids.location,
    });
    const { error: pullError } = await admin.rpc("workflow_v2_pull_job_onto_bench", {
      p_job_id: ids.jobA,
      p_actor_user_id: ids.techA,
    });
    expect(pullError).toBeNull();

    // Pulling job B parks job A and moves the single open timer.
    const { data: swap, error: swapError } = await admin.rpc(
      "workflow_v2_pull_job_onto_bench",
      { p_job_id: ids.jobB, p_actor_user_id: ids.techA }
    );
    expect(swapError).toBeNull();
    expect((swap as { parked_job_id: string }).parked_job_id).toBe(ids.jobA);

    const { data: openTimers } = await admin
      .from("job_time_entry")
      .select("job_id")
      .eq("user_id", ids.techA)
      .is("ended_at", null);
    expect(openTimers).toHaveLength(1);
    expect(openTimers?.[0]?.job_id).toBe(ids.jobB);

    const { data: parkedA } = await admin
      .from("job")
      .select("status, floor_park_reason")
      .eq("job_id", ids.jobA)
      .single();
    expect(parkedA?.status).toBe("ready_to_start");
    expect(parkedA?.floor_park_reason).toBe("swapped");

    // Completion is gated on the checklist.
    await admin.from("job_checklist_item").insert({
      job_id: ids.jobB,
      title: "IT gate step",
      sort_order: 1,
    });
    const { error: gateError } = await admin.rpc(
      "workflow_v2_complete_job_and_assign_qc",
      {
        p_job_id: ids.jobB,
        p_actor_user_id: ids.techA,
        p_proof_exception: true,
      }
    );
    expect(gateError?.message ?? "").toContain("JOB_CHECKLIST_INCOMPLETE");

    await admin
      .from("job_checklist_item")
      .update({ checked_at: new Date().toISOString(), checked_by_user_id: ids.techA })
      .eq("job_id", ids.jobB);

    // QC candidate who worked the visit is rejected.
    const { error: badQcError } = await admin.rpc(
      "workflow_v2_complete_job_and_assign_qc",
      {
        p_job_id: ids.jobB,
        p_actor_user_id: ids.techA,
        p_qc_candidate_id: ids.techA,
        p_proof_exception: true,
      }
    );
    expect(badQcError?.message ?? "").toContain("QC_CANDIDATE_WORKED_ON_VISIT");

    // Job A still open, so completing B assigns no visit QC yet.
    const { data: completeB, error: completeBError } = await admin.rpc(
      "workflow_v2_complete_job_and_assign_qc",
      {
        p_job_id: ids.jobB,
        p_actor_user_id: ids.techA,
        p_proof_exception: true,
      }
    );
    expect(completeBError).toBeNull();
    expect((completeB as { visit_work_remaining: number }).visit_work_remaining).toBe(1);

    // Finish job A with techB as the QC peer.
    const { error: pullA } = await admin.rpc("workflow_v2_pull_job_onto_bench", {
      p_job_id: ids.jobA,
      p_actor_user_id: ids.techA,
    });
    expect(pullA).toBeNull();
    const { data: completeA, error: completeAError } = await admin.rpc(
      "workflow_v2_complete_job_and_assign_qc",
      {
        p_job_id: ids.jobA,
        p_actor_user_id: ids.techA,
        p_qc_candidate_id: ids.techB,
        p_proof_exception: true,
      }
    );
    expect(completeAError).toBeNull();
    expect((completeA as { qc_assigned_to: string }).qc_assigned_to).toBe(ids.techB);

    // techA cannot QC own work; techB can. Fail reopens targeted job while
    // preserving its completion timestamp evidence in the attempt history.
    const { error: ownQcError } = await admin.rpc("workflow_v2_record_qc_attempt", {
      p_work_order_id: ids.workOrder,
      p_actor_user_id: ids.techA,
      p_outcome: "failed",
      p_scope_hash: "scope-1",
      p_rework_job_ids: [ids.jobA],
    });
    expect(ownQcError?.message ?? "").toContain("QC_CANNOT_CHECK_OWN_WORK");

    const { error: failError } = await admin.rpc("workflow_v2_record_qc_attempt", {
      p_work_order_id: ids.workOrder,
      p_actor_user_id: ids.techB,
      p_outcome: "failed",
      p_scope_hash: "scope-1",
      p_rework_job_ids: [ids.jobA],
    });
    expect(failError).toBeNull();

    const { data: reworkA } = await admin
      .from("job")
      .select("status, completed_at")
      .eq("job_id", ids.jobA)
      .single();
    expect(reworkA?.status).toBe("ready_to_start");
    expect(reworkA?.completed_at).not.toBeNull();

    const { count: attempts } = await admin
      .from("quality_check_attempt")
      .select("attempt_id", { count: "exact", head: true })
      .eq("work_order_id", ids.workOrder);
    expect(attempts).toBe(1);
  }, 60_000);
});
