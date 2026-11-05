import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createAnonClient, createServiceClient, describeIntegration } from "./helpers";

describeIntegration("reserve customer credit", () => {
  it("moves a balance onto invoices once and gives it back, including a simultaneous reserve", async () => {
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

      const balances = async () => {
        const rows = await admin
          .from("customer_credit")
          .select("credit_id, remaining_amount")
          .eq("customer_id", customerId);
        return new Map(
          (rows.data ?? []).map((row) => [
            row.credit_id as string,
            Number(row.remaining_amount),
          ])
        );
      };
      const held = async (invoiceId: string) => {
        const row = await admin
          .from("wix_invoice")
          .select("credit_applied_cents")
          .eq("wix_invoice_id", invoiceId)
          .single();
        return Number(row.data?.credit_applied_cents);
      };

      // A lower target gives the difference back, newest balance first.
      const heldOnA = appliedById.get(invoiceA)!;
      const lowered = await admin.rpc("reserve_customer_credit", {
        p_customer_id: customerId,
        p_wix_invoice_id: invoiceA,
        p_target_cents: heldOnA - 1000,
      });
      expect(lowered.error).toBeNull();
      expect(lowered.data).toBe(heldOnA - 1000);
      expect(await held(invoiceA)).toBe(heldOnA - 1000);
      expect((await balances()).get(creditNew)).toBe(10);
      expect((await balances()).get(creditOld)).toBe(0);

      // A paid invoice cannot take more credit, but can still give it back.
      expect(
        (
          await admin
            .from("wix_invoice")
            .update({ status: "PAID" })
            .eq("wix_invoice_id", invoiceB)
        ).error
      ).toBeNull();
      const heldOnB = await held(invoiceB);
      const sealed = await admin.rpc("reserve_customer_credit", {
        p_customer_id: customerId,
        p_wix_invoice_id: invoiceB,
        p_target_cents: heldOnB + 500,
      });
      expect(sealed.error?.message ?? "").toMatch(/WIX_INVOICE_SEALED/);
      expect(await held(invoiceB)).toBe(heldOnB);
      expect((await balances()).get(creditNew)).toBe(10);

      // Zero returns everything, and a balance that no longer exists is replaced.
      expect(
        (await admin.from("customer_credit").delete().eq("credit_id", creditOld)).error
      ).toBeNull();
      const returnedA = await admin.rpc("reserve_customer_credit", {
        p_customer_id: customerId,
        p_wix_invoice_id: invoiceA,
        p_target_cents: 0,
      });
      const returnedB = await admin.rpc("reserve_customer_credit", {
        p_customer_id: customerId,
        p_wix_invoice_id: invoiceB,
        p_target_cents: 0,
      });
      expect(returnedA.error).toBeNull();
      expect(returnedB.error).toBeNull();
      expect(returnedA.data).toBe(0);
      expect(returnedB.data).toBe(0);
      expect(await held(invoiceA)).toBe(0);
      expect(await held(invoiceB)).toBe(0);
      const afterReturn = await balances();
      expect(afterReturn.get(creditNew)).toBe(40.1);
      const returnedCents = [...afterReturn.values()].reduce(
        (sum, dollars) => sum + Math.round(dollars * 100),
        0
      );
      expect(returnedCents).toBe(10010);
      const replacement = await admin
        .from("customer_credit")
        .select("reason, amount")
        .eq("customer_id", customerId)
        .like("reason", "Returned from invoice %");
      const replacedCents = (replacement.data ?? []).reduce(
        (sum, row) => sum + Math.round(Number(row.amount) * 100),
        0
      );
      expect(replacedCents).toBe(6000);

      const negative = await admin.rpc("reserve_customer_credit", {
        p_customer_id: customerId,
        p_wix_invoice_id: invoiceA,
        p_target_cents: -1,
      });
      expect(negative.error?.message ?? "").toMatch(/CREDIT_RESERVE_INVALID/);

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
