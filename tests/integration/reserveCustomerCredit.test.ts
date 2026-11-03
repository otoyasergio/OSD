import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createAnonClient, createServiceClient, describeIntegration } from "./helpers";

describeIntegration("reserve customer credit", () => {
  it("spends a balance once across two invoices, including a simultaneous reserve", async () => {
    const admin = createServiceClient();
    const customerId = randomUUID();
    const otherCustomerId = randomUUID();
    const invoiceA = randomUUID();
    const invoiceB = randomUUID();
    const creditOld = randomUUID();
    const creditNew = randomUUID();
    const suffix = String(Date.now()).slice(-6);

    const cleanup = async () => {
      await admin.from("customer_credit").delete().eq("customer_id", customerId);
      await admin.from("wix_invoice").delete().in("wix_invoice_id", [invoiceA, invoiceB]);
      await admin
        .from("customer")
        .delete()
        .in("customer_id", [customerId, otherCustomerId]);
    };

    try {
      expect(
        (
          await admin.from("customer").insert([
            {
              customer_id: customerId,
              first_name: "Credit",
              last_name: "Holder",
              phone: "647-555-0142",
            },
            {
              customer_id: otherCustomerId,
              first_name: "Other",
              last_name: "Customer",
              phone: "647-555-0143",
            },
          ])
        ).error
      ).toBeNull();

      expect(
        (
          await admin.from("wix_invoice").insert([
            {
              wix_invoice_id: invoiceA,
              display_number: `8${suffix}1`,
              invoice_number: Number(`8${suffix}1`),
              status: "DRAFT",
              customer_id: customerId,
              total_cents: 20000,
            },
            {
              wix_invoice_id: invoiceB,
              display_number: `8${suffix}2`,
              invoice_number: Number(`8${suffix}2`),
              status: "DRAFT",
              customer_id: customerId,
              total_cents: 20000,
            },
          ])
        ).error
      ).toBeNull();

      expect(
        (
          await admin.from("customer_credit").insert([
            {
              credit_id: creditOld,
              customer_id: customerId,
              amount: 60,
              remaining_amount: 60,
              reason: "Overpayment",
              created_at: "2026-01-01T00:00:00.000Z",
            },
            {
              credit_id: creditNew,
              customer_id: customerId,
              amount: 40.1,
              remaining_amount: 40.1,
              reason: "Goodwill",
              created_at: "2026-02-01T00:00:00.000Z",
            },
          ])
        ).error
      ).toBeNull();

      const first = await admin.rpc("reserve_customer_credit", {
        p_customer_id: customerId,
        p_wix_invoice_id: invoiceA,
        p_target_cents: 5000,
      });
      expect(first.error).toBeNull();
      expect(first.data).toBe(5000);

      const partial = await admin
        .from("customer_credit")
        .select("credit_id, remaining_amount");
      const oldRow = partial.data?.find((row) => row.credit_id === creditOld);
      const newRow = partial.data?.find((row) => row.credit_id === creditNew);
      expect(Number(oldRow?.remaining_amount)).toBe(10);
      expect(Number(newRow?.remaining_amount)).toBe(40.1);

      const again = await admin.rpc("reserve_customer_credit", {
        p_customer_id: customerId,
        p_wix_invoice_id: invoiceA,
        p_target_cents: 5000,
      });
      expect(again.error).toBeNull();
      expect(again.data).toBe(5000);
      const untouched = await admin
        .from("customer_credit")
        .select("remaining_amount")
        .eq("credit_id", creditOld)
        .single();
      expect(Number(untouched.data?.remaining_amount)).toBe(10);

      const mismatch = await admin.rpc("reserve_customer_credit", {
        p_customer_id: otherCustomerId,
        p_wix_invoice_id: invoiceA,
        p_target_cents: 1000,
      });
      expect(mismatch.error?.message ?? "").toMatch(/CUSTOMER_MISMATCH/);

      const [left, right] = await Promise.all([
        admin.rpc("reserve_customer_credit", {
          p_customer_id: customerId,
          p_wix_invoice_id: invoiceA,
          p_target_cents: 20000,
        }),
        admin.rpc("reserve_customer_credit", {
          p_customer_id: customerId,
          p_wix_invoice_id: invoiceB,
          p_target_cents: 20000,
        }),
      ]);
      expect(left.error).toBeNull();
      expect(right.error).toBeNull();

      const applied = await admin
        .from("wix_invoice")
        .select("wix_invoice_id, credit_applied_cents")
        .in("wix_invoice_id", [invoiceA, invoiceB]);
      const appliedById = new Map(
        (applied.data ?? []).map((row) => [
          row.wix_invoice_id as string,
          Number(row.credit_applied_cents),
        ])
      );
      expect(appliedById.get(invoiceA)! + appliedById.get(invoiceB)!).toBe(10010);
      expect(appliedById.get(invoiceA)).toBeGreaterThanOrEqual(5000);

      const remaining = await admin
        .from("customer_credit")
        .select("remaining_amount")
        .eq("customer_id", customerId);
      const leftover = (remaining.data ?? []).reduce(
        (sum, row) => sum + Number(row.remaining_amount),
        0
      );
      expect(leftover).toBe(0);

      const anon = createAnonClient();
      const denied = await anon.rpc("reserve_customer_credit", {
        p_customer_id: customerId,
        p_wix_invoice_id: invoiceA,
        p_target_cents: 100,
      });
      expect(denied.error).toBeTruthy();
    } finally {
      await cleanup();
    }
  });
});
