import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createAnonClient,
  createServiceClient,
  integrationConfigured,
} from "@/tests/integration/helpers";
import { buildPassportDraft } from "@/lib/passport/buildDraft";
import {
  generatePassportNumber,
  collectPassportSensitiveValues,
} from "@/lib/passport/source";
import { generatePassportShareToken, passportShareExpiry } from "@/lib/passport/tokens";

const configured = integrationConfigured();
const anonConfigured = Boolean(process.env.TEST_SUPABASE_ANON_KEY?.trim());
const suiteReady = configured && anonConfigured;
const describePassportIntegration = suiteReady ? describe : describe.skip;
const PASSWORD = "Synthetic-Passport-2026!";

describePassportIntegration("vehicle passport privacy boundary (isolated db)", () => {
  it("publishes no prior-owner PII or money, freezes content, and revokes on transfer", async () => {
    const admin = createServiceClient();
    const ids = {
      location: randomUUID(),
      advisor: randomUUID(),
      ownerA: randomUUID(),
      ownerB: randomUUID(),
      motorcycle: randomUUID(),
      workOrder: randomUUID(),
      service: randomUUID(),
      job: randomUUID(),
      communication: randomUUID(),
      payment: randomUUID(),
    };
    const advisorEmail = `it-passport-${ids.advisor.slice(0, 8)}@otomoto.invalid`;
    const priorEmail = `prior-${ids.ownerA.slice(0, 8)}@example.invalid`;
    const priorPhone = "647-555-0199";
    const messageMarker = `PRIVATE-MESSAGE-${ids.communication}`;
    const paymentMarker = `sq-private-${ids.payment}`;
    const completedAt = new Date(Date.now() - 86_400_000).toISOString();

    const authUser = await admin.auth.admin.createUser({
      id: ids.advisor,
      email: advisorEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(authUser.error).toBeNull();

    expect(
      (
        await admin.from("location").insert({
          location_id: ids.location,
          name: "Passport Integration",
          code: `VP${ids.location.slice(0, 4)}`,
          status: "active",
        })
      ).error
    ).toBeNull();
    expect(
      (
        await admin.from("app_user").insert({
          user_id: ids.advisor,
          auth_user_id: ids.advisor,
          first_name: "Passport",
          last_name: "Advisor",
          email: advisorEmail,
          role: "service_advisor",
          status: "active",
        })
      ).error
    ).toBeNull();
    expect(
      (
        await admin.from("user_location").insert({
          user_id: ids.advisor,
          location_id: ids.location,
        })
      ).error
    ).toBeNull();
    expect(
      (
        await admin.from("customer").insert([
          {
            customer_id: ids.ownerA,
            first_name: "Prior",
            last_name: "Owner",
            phone: priorPhone,
            email: priorEmail,
            address: "1 Private Street, Toronto, ON",
          },
          {
            customer_id: ids.ownerB,
            first_name: "Next",
            last_name: "Owner",
            phone: "647-555-0123",
            email: `next-${ids.ownerB.slice(0, 8)}@example.invalid`,
          },
        ])
      ).error
    ).toBeNull();
    expect(
      (
        await admin.from("motorcycle").insert({
          motorcycle_id: ids.motorcycle,
          customer_id: ids.ownerA,
          year: 2021,
          make: "Honda",
          model: "CB650R",
          vin: `TESTVIN${ids.motorcycle.replaceAll("-", "").slice(0, 10)}`,
          colour: "Red",
        })
      ).error
    ).toBeNull();
    expect(
      (
        await admin.from("work_order").insert({
          work_order_id: ids.workOrder,
          motorcycle_id: ids.motorcycle,
          customer_id: ids.ownerA,
          location_id: ids.location,
          work_order_number: `VP-${ids.workOrder.slice(0, 8)}`,
          status: "completed",
          mileage: 12_450,
          mileage_unit: "km",
          completed_at: completedAt,
        })
      ).error
    ).toBeNull();
    expect(
      (
        await admin.from("service").insert({
          service_id: ids.service,
          name: `Passport Service ${ids.service.slice(0, 8)}`,
          standard_price: 125,
          estimated_labour: 1,
        })
      ).error
    ).toBeNull();
    expect(
      (
        await admin.from("job").insert({
          job_id: ids.job,
          work_order_id: ids.workOrder,
          service_id: ids.service,
          service_name_snapshot: "Engine oil and filter service",
          standard_price_snapshot: 125,
          estimated_labour_snapshot: 1,
          status: "completed",
          completed_at: completedAt,
        })
      ).error
    ).toBeNull();
    expect(
      (
        await admin.from("communication_log").insert({
          log_id: ids.communication,
          work_order_id: ids.workOrder,
          customer_id: ids.ownerA,
          channel: "sms",
          direction: "outbound",
          to_address: priorPhone,
          body: messageMarker,
          status: "sent",
        })
      ).error
    ).toBeNull();
    expect(
      (
        await admin.from("payment").insert({
          payment_id: ids.payment,
          work_order_id: ids.workOrder,
          provider: "square",
          provider_transaction_id: paymentMarker,
          amount_cents: 14_125,
          status: "succeeded",
        })
      ).error
    ).toBeNull();

    const advisor = createAnonClient();
    const signedIn = await advisor.auth.signInWithPassword({
      email: advisorEmail,
      password: PASSWORD,
    });
    expect(signedIn.error).toBeNull();

    const passportNumber = generatePassportNumber();
    const draft = buildPassportDraft({
      passportNumber,
      reportVersion: 1,
      issuedAt: new Date().toISOString(),
      motorcycle: {
        year: 2021,
        make: "Honda",
        model: "CB650R",
        vin: `TESTVIN${ids.motorcycle.replaceAll("-", "").slice(0, 10)}`,
        colour: "Red",
      },
      workOrders: [
        {
          work_order_id: ids.workOrder,
          work_order_number: `VP-${ids.workOrder.slice(0, 8)}`,
          status: "completed",
          completed_at: completedAt,
          mileage: 12_450,
          mileage_unit: "km",
          location_name: "Toronto",
          jobs: [
            {
              job_id: ids.job,
              service_name_snapshot: "Engine oil and filter service",
              status: "completed",
              part_requirements: [],
            },
          ],
        },
      ],
      sensitiveValues: collectPassportSensitiveValues([
        {
          first_name: "Prior",
          last_name: "Owner",
          phone: priorPhone,
          email: priorEmail,
          address: "1 Private Street, Toronto, ON",
        },
      ]),
    });

    const published = await advisor.rpc("publish_vehicle_passport_snapshot", {
      p_motorcycle_id: ids.motorcycle,
      p_passport_number: passportNumber,
      p_expected_version: 1,
      p_payload: draft.payload,
      p_payload_sha256: draft.payloadSha256,
      p_coverage_through: draft.payload.coverage_through,
      p_work_order_ids: draft.sourceWorkOrderIds,
    });
    expect(published.error).toBeNull();
    const snapshotId = (published.data as Array<{ published_snapshot_id: string }>)[0]
      .published_snapshot_id;

    const persisted = await admin
      .from("vehicle_passport_snapshot")
      .select("payload")
      .eq("snapshot_id", snapshotId)
      .single();
    expect(persisted.error).toBeNull();
    const serialized = JSON.stringify(persisted.data?.payload);
    for (const forbidden of [
      "Prior Owner",
      priorEmail,
      priorPhone,
      "1 Private Street",
      messageMarker,
      paymentMarker,
      "14125",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const { token: _token, hash } = generatePassportShareToken();
    const share = await advisor.rpc("create_vehicle_passport_share", {
      p_snapshot_id: snapshotId,
      p_token_hash: hash,
      p_expires_at: passportShareExpiry(),
    });
    expect(share.error).toBeNull();
    const shareId = (share.data as Array<{ created_share_id: string }>)[0]
      .created_share_id;

    expect(
      (
        await admin
          .from("job")
          .update({ service_name_snapshot: "MUTATED SOURCE" })
          .eq("job_id", ids.job)
      ).error
    ).toBeNull();
    const frozen = await admin
      .from("vehicle_passport_snapshot")
      .select("payload")
      .eq("snapshot_id", snapshotId)
      .single();
    expect(JSON.stringify(frozen.data?.payload)).not.toContain("MUTATED SOURCE");

    const mutation = await admin
      .from("vehicle_passport_snapshot")
      .update({ payload_sha256: "0".repeat(64) })
      .eq("snapshot_id", snapshotId);
    expect(mutation.error?.message ?? "").toContain("PASSPORT_SNAPSHOT_IMMUTABLE");

    const anon = createAnonClient();
    const anonymousRead = await anon
      .from("vehicle_passport_snapshot")
      .select("snapshot_id")
      .limit(1);
    expect(anonymousRead.error).not.toBeNull();

    const transferred = await advisor
      .from("motorcycle")
      .update({ customer_id: ids.ownerB })
      .eq("motorcycle_id", ids.motorcycle);
    expect(transferred.error).toBeNull();

    const revoked = await admin
      .from("vehicle_passport_share")
      .select("revoked_at, revocation_reason")
      .eq("share_id", shareId)
      .single();
    expect(revoked.error).toBeNull();
    expect(revoked.data?.revoked_at).toBeTruthy();
    expect(revoked.data?.revocation_reason).toBe("ownership_transfer");

    const historicalVisit = await admin
      .from("work_order")
      .select("customer_id")
      .eq("work_order_id", ids.workOrder)
      .single();
    expect(historicalVisit.data?.customer_id).toBe(ids.ownerA);
  });
});

if (configured && !anonConfigured) {
  it.skip("vehicle passport integration suite needs TEST_SUPABASE_ANON_KEY from the isolated stack", () => {});
}
