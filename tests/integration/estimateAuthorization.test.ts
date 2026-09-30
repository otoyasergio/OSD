import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServiceClient, describeIntegration } from "@/tests/integration/helpers";
import { buildEstimateVersionSnapshot } from "@/lib/services/estimatePricing";
import { computeDecisionsHash } from "@/lib/services/estimateAuthorization";

/**
 * Transactional command tests for the estimate document flow. Runs only
 * against an isolated database (TEST_SUPABASE_URL) — CI job `integration`.
 */

const admin = process.env.TEST_SUPABASE_URL ? createServiceClient() : null;

const ids = {
  location: randomUUID(),
  advisor: randomUUID(),
  customer: randomUUID(),
  motorcycle: randomUUID(),
  workOrder: randomUUID(),
  jobA: randomUUID(),
  jobB: randomUUID(),
  jobC: randomUUID(),
  service: randomUUID(),
};

function snapshot() {
  return buildEstimateVersionSnapshot([
    {
      jobId: ids.jobA,
      title: "Brake service",
      description: null,
      pricing: {
        pricingMode: "itemized",
        fixedPackagePriceCents: null,
        laborLines: [{ amountCents: 20000, billable: true, includedInPackage: false }],
        partLines: [{ quantity: 1, sellPriceCents: 5000, includedInPackage: false }],
        feeLines: [{ amountCents: 1000 }],
        discountLines: [],
      },
    },
    {
      jobId: ids.jobB,
      title: "Oil package",
      description: null,
      pricing: {
        pricingMode: "fixed_package",
        fixedPackagePriceCents: 10000,
        laborLines: [],
        partLines: [],
        feeLines: [],
        discountLines: [],
      },
    },
    {
      jobId: ids.jobC,
      title: "Chain adjustment",
      description: null,
      pricing: {
        pricingMode: "itemized",
        fixedPackagePriceCents: null,
        laborLines: [{ amountCents: 5000, billable: true, includedInPackage: false }],
        partLines: [],
        feeLines: [],
        discountLines: [],
      },
    },
  ]);
}

function presentPayload(snap = snapshot()) {
  return {
    jobs: snap.jobs.map((job) => ({
      jobId: job.jobId,
      displayOrder: job.displayOrder,
      title: job.title,
      description: job.description,
      pricingMode: job.pricingMode,
      laborCents: job.breakdown.laborCents,
      partsCents: job.breakdown.partsCents,
      feesCents: job.breakdown.feesCents,
      discountCents: job.breakdown.discountCents,
      taxCents: job.breakdown.taxCents,
      totalCents: job.breakdown.totalCents,
    })),
    lines: snap.lines.map((line) => ({
      kind: line.kind,
      jobId: line.job_id,
      description: line.description,
      quantity: line.quantity,
      unitAmountCents: line.unit_amount_cents,
      extendedAmountCents: line.extended_amount_cents,
      taxRateBps: line.tax_rate_bps,
      taxAmountCents: line.tax_amount_cents,
      position: line.position,
    })),
    totals: {
      subtotalCents: snap.totals.subtotalCents,
      discountCents: snap.totals.discountCents,
      taxCents: snap.totals.taxCents,
      totalCents: snap.totals.totalCents,
    },
    contentHash: snap.contentHash,
  };
}

describeIntegration("workflow_v2 estimate commands (isolated db)", () => {
  beforeAll(async () => {
    if (!admin) return;
    await admin.from("location").upsert({
      location_id: ids.location,
      name: "Estimate IT",
      code: `EI${ids.location.slice(0, 4)}`,
    });
    await admin.from("app_user").upsert({
      user_id: ids.advisor,
      first_name: "IT",
      last_name: "Advisor",
      email: `it-advisor-${ids.advisor.slice(0, 8)}@otomoto.invalid`,
      role: "service_advisor",
      status: "active",
    });
    await admin.from("customer").upsert({
      customer_id: ids.customer,
      first_name: "IT",
      last_name: "Customer",
      email: `it-customer-${ids.customer.slice(0, 8)}@otomoto.invalid`,
    });
    await admin.from("motorcycle").upsert({
      motorcycle_id: ids.motorcycle,
      customer_id: ids.customer,
      year: 2024,
      make: "Test",
      model: "Integration",
    });
    await admin.from("work_order").upsert({
      work_order_id: ids.workOrder,
      motorcycle_id: ids.motorcycle,
      location_id: ids.location,
      work_order_number: `WO-IT-${ids.workOrder.slice(0, 8)}`,
      status: "open",
    });
    await admin.from("service").upsert({
      service_id: ids.service,
      name: `IT Service ${ids.service.slice(0, 8)}`,
      standard_price: 100,
      estimated_labour: 1,
    });
    for (const [jobId, name] of [
      [ids.jobA, "Brake service"],
      [ids.jobB, "Oil package"],
      [ids.jobC, "Chain adjustment"],
    ] as const) {
      await admin.from("job").upsert({
        job_id: jobId,
        work_order_id: ids.workOrder,
        service_id: ids.service,
        service_name_snapshot: name,
        standard_price_snapshot: 100,
        estimated_labour_snapshot: 1,
        status: "draft",
      });
    }
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("work_order").delete().eq("work_order_id", ids.workOrder);
    await admin.from("motorcycle").delete().eq("motorcycle_id", ids.motorcycle);
    await admin.from("customer").delete().eq("customer_id", ids.customer);
    await admin.from("service").delete().eq("service_id", ids.service);
    await admin.from("app_user").delete().eq("user_id", ids.advisor);
    await admin.from("location").delete().eq("location_id", ids.location);
  });

  it("presents, blocks stale confirmation, confirms once, and replays idempotently", async () => {
    if (!admin) return;
    const snap = snapshot();

    // Present.
    const { data: presented, error: presentError } = await admin.rpc(
      "workflow_v2_present_estimate",
      {
        p_work_order_id: ids.workOrder,
        p_actor_user_id: ids.advisor,
        p_payload: presentPayload(snap),
        p_idempotency_key: `it-present-${ids.workOrder}`,
      }
    );
    expect(presentError).toBeNull();
    const versionId = (presented as { estimate_version_id: string }).estimate_version_id;
    expect(versionId).toBeTruthy();

    // Presented version is immutable.
    const { error: mutateError } = await admin
      .from("estimate_version")
      .update({ total_cents: 1 })
      .eq("estimate_version_id", versionId);
    expect(mutateError?.message ?? "").toContain("ESTIMATE_VERSION_IMMUTABLE");

    // Presented jobs project to legacy waiting_for_approval.
    const { data: legacyJobs } = await admin
      .from("job")
      .select("job_id, status")
      .eq("work_order_id", ids.workOrder);
    expect((legacyJobs ?? []).every((row) => row.status === "waiting_for_approval")).toBe(
      true
    );

    const decisions = [
      { jobId: ids.jobA, decision: "approved" },
      { jobId: ids.jobB, decision: "approved" },
      { jobId: ids.jobC, decision: "declined" },
    ];
    const decisionsHash = computeDecisionsHash(
      decisions.map((d) => ({ jobId: d.jobId, decision: d.decision as never }))
    );

    // Stale content hash rejected.
    const { error: staleError } = await admin.rpc("workflow_v2_confirm_estimate", {
      p_estimate_version_id: versionId,
      p_decisions: decisions,
      p_decisions_hash: decisionsHash,
      p_expected_content_hash: "wrong-hash",
      p_actor_type: "staff",
      p_actor_user_id: ids.advisor,
      p_method: "in_person",
    });
    expect(staleError?.message ?? "").toContain("ESTIMATE_CONTENT_STALE");

    // Missing decision rejected.
    const { error: missingError } = await admin.rpc("workflow_v2_confirm_estimate", {
      p_estimate_version_id: versionId,
      p_decisions: decisions.slice(0, 2),
      p_decisions_hash: decisionsHash,
      p_expected_content_hash: snap.contentHash,
      p_actor_type: "staff",
      p_actor_user_id: ids.advisor,
      p_method: "in_person",
    });
    expect(missingError?.message ?? "").toContain("DECISION_MISSING");

    // Confirm succeeds.
    const { data: confirmed, error: confirmError } = await admin.rpc(
      "workflow_v2_confirm_estimate",
      {
        p_estimate_version_id: versionId,
        p_decisions: decisions,
        p_decisions_hash: decisionsHash,
        p_expected_content_hash: snap.contentHash,
        p_actor_type: "staff",
        p_actor_user_id: ids.advisor,
        p_method: "in_person",
      }
    );
    expect(confirmError).toBeNull();
    expect((confirmed as { replayed: boolean }).replayed).toBe(false);

    // Replay returns the same confirmation without duplicating evidence.
    const { data: replayed, error: replayError } = await admin.rpc(
      "workflow_v2_confirm_estimate",
      {
        p_estimate_version_id: versionId,
        p_decisions: decisions,
        p_decisions_hash: decisionsHash,
        p_expected_content_hash: snap.contentHash,
        p_actor_type: "staff",
        p_actor_user_id: ids.advisor,
        p_method: "in_person",
      }
    );
    expect(replayError).toBeNull();
    expect((replayed as { replayed: boolean }).replayed).toBe(true);

    const { count: confirmations } = await admin
      .from("estimate_confirmation")
      .select("confirmation_id", { count: "exact", head: true })
      .eq("estimate_version_id", versionId);
    expect(confirmations).toBe(1);

    const { count: decisionRows } = await admin
      .from("estimate_job_decision")
      .select("decision_id", { count: "exact", head: true })
      .eq("estimate_version_id", versionId);
    expect(decisionRows).toBe(3);

    // Legacy projection after confirmation.
    const { data: afterJobs } = await admin
      .from("job")
      .select("job_id, status")
      .eq("work_order_id", ids.workOrder);
    const byId = new Map((afterJobs ?? []).map((row) => [row.job_id, row.status]));
    expect(byId.get(ids.jobA)).toBe("approved");
    expect(byId.get(ids.jobB)).toBe("approved");
    expect(byId.get(ids.jobC)).toBe("declined");

    // Invoice copies only the approved scope: 360 + 46.80 = 406.80.
    const { data: invoice, error: invoiceError } = await admin.rpc(
      "workflow_v2_issue_invoice",
      {
        p_work_order_id: ids.workOrder,
        p_actor_user_id: ids.advisor,
        p_idempotency_key: `it-invoice-${ids.workOrder}`,
      }
    );
    expect(invoiceError).toBeNull();
    expect((invoice as { total_cents: number }).total_cents).toBe(40680);

    // Payment applies idempotently.
    const invoiceId = (invoice as { invoice_id: string }).invoice_id;
    for (let i = 0; i < 2; i += 1) {
      const { error: payError } = await admin.rpc("workflow_v2_apply_payment_event", {
        p_provider: "square",
        p_provider_transaction_id: `it-pay-${ids.workOrder}`,
        p_work_order_id: ids.workOrder,
        p_invoice_id: invoiceId,
        p_amount_cents: 40680,
        p_status: "succeeded",
      });
      expect(payError).toBeNull();
    }
    const { data: paidInvoice } = await admin
      .from("invoice")
      .select("status, balance_cents")
      .eq("invoice_id", invoiceId)
      .single();
    expect(paidInvoice?.status).toBe("paid");
    expect(paidInvoice?.balance_cents).toBe(0);
  }, 60_000);
});
