import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createAnonClient, createServiceClient, describeIntegration } from "./helpers";

describeIntegration("wix invoice ledger", () => {
  it("stores a Wix invoice before a work order, then links the display number", async () => {
    const admin = createServiceClient();
    const customerId = randomUUID();
    const otherCustomerId = randomUUID();
    const motorcycleId = randomUUID();
    const workOrderId = randomUUID();
    const staffId = randomUUID();
    const vin = "HNDLEDGERTEST00001";
    const displayNumber = `9${String(Date.now()).slice(-6)}`;
    const wixInvoiceId = randomUUID();

    const { data: location, error: locationError } = await admin
      .from("location")
      .select("location_id")
      .limit(1)
      .maybeSingle();
    expect(locationError).toBeNull();
    expect(location?.location_id).toBeTruthy();

    const cleanup = async () => {
      await admin.from("wix_invoice").delete().eq("wix_invoice_id", wixInvoiceId);
      await admin.from("invoice_create_acknowledgement").delete().eq("customer_id", customerId);
      await admin.from("customer_private_profile").delete().eq("customer_id", customerId);
      await admin.from("work_order").delete().eq("work_order_id", workOrderId);
      await admin.from("motorcycle").delete().eq("motorcycle_id", motorcycleId);
      await admin.from("app_user").delete().eq("user_id", staffId);
      await admin.from("customer").delete().in("customer_id", [customerId, otherCustomerId]);
    };

    try {
      expect(
        (
          await admin.from("customer").insert([
            {
              customer_id: customerId,
              first_name: "Wix",
              last_name: "Ledger",
              phone: "647-555-0199",
            },
            {
              customer_id: otherCustomerId,
              first_name: "Prior",
              last_name: "Owner",
              email: `prior-${customerId}@otomoto.invalid`,
            },
          ])
        ).error
      ).toBeNull();

      expect(
        (
          await admin.from("motorcycle").insert({
            motorcycle_id: motorcycleId,
            customer_id: customerId,
            year: 2018,
            make: "Honda",
            model: "CB500",
            vin,
            colour: "Red",
            plate_number: "N/A",
          })
        ).error
      ).toBeNull();

      expect(
        (
          await admin.from("app_user").insert({
            user_id: staffId,
            first_name: "Gate",
            last_name: "Advisor",
            email: `wix-ledger-${staffId}@otomoto.invalid`,
            role: "service_advisor",
            status: "active",
          })
        ).error
      ).toBeNull();

      const hold = await admin
        .from("invoice_create_acknowledgement")
        .insert({
          customer_id: customerId,
          motorcycle_id: motorcycleId,
          staff_user_id: staffId,
          wix_error_text: "Wix did not return an invoice number for Wix Ledger on 2018 Honda CB500.",
          pending_work_order_id: workOrderId,
        })
        .select("acknowledgement_id, work_order_id")
        .single();
      expect(hold.error).toBeNull();
      expect(hold.data?.work_order_id).toBeNull();

      const invoice = await admin
        .from("wix_invoice")
        .insert({
          wix_invoice_id: wixInvoiceId,
          display_number: displayNumber,
          invoice_number: Number(displayNumber),
          status: "DRAFT",
          customer_id: customerId,
          motorcycle_id: motorcycleId,
          vin_snapshot: vin,
          pending_work_order_id: workOrderId,
          total_cents: 10000,
        })
        .select("work_order_id, display_number")
        .single();
      expect(invoice.error).toBeNull();
      expect(invoice.data?.work_order_id).toBeNull();

      const workOrder = await admin
        .from("work_order")
        .insert({
          work_order_id: workOrderId,
          motorcycle_id: motorcycleId,
          customer_id: customerId,
          location_id: location?.location_id,
          work_order_number: displayNumber,
          status: "open",
          mileage: 12000,
        })
        .select("work_order_number, invoice_number_int")
        .single();
      expect(workOrder.error).toBeNull();
      expect(workOrder.data?.invoice_number_int).toBe(Number(displayNumber));

      expect(
        (
          await admin
            .from("wix_invoice")
            .update({ work_order_id: workOrderId, pending_work_order_id: null })
            .eq("wix_invoice_id", wixInvoiceId)
        ).error
      ).toBeNull();

      expect(
        (
          await admin
            .from("invoice_create_acknowledgement")
            .update({ cleared_at: new Date().toISOString() })
            .eq("acknowledgement_id", hold.data?.acknowledgement_id)
        ).error
      ).toBeNull();

      const byCustomer = await admin
        .from("wix_invoice")
        .select("display_number")
        .eq("customer_id", customerId);
      expect(byCustomer.data?.map((row) => row.display_number)).toContain(displayNumber);

      const byVin = await admin.from("wix_invoice").select("display_number").eq("vin_snapshot", vin);
      expect(byVin.data?.map((row) => row.display_number)).toContain(displayNumber);

      expect(
        (
          await admin.from("wix_invoice_payment").insert({
            wix_payment_id: `void-test:${wixInvoiceId}`,
            wix_invoice_id: wixInvoiceId,
            amount_cents: 10000,
            method: "paypal",
            square_status: "skipped_void",
          })
        ).error
      ).toBeNull();

      expect(
        (
          await admin.from("customer_private_profile").upsert({
            customer_id: customerId,
            licence_number: "D1234-56789-01234",
            licence_expiry: "2030-01-01",
          })
        ).error
      ).toBeNull();

      const anon = createAnonClient();
      const hidden = await anon.from("wix_invoice").select("display_number").eq("wix_invoice_id", wixInvoiceId);
      expect(hidden.data ?? []).toEqual([]);
      const hiddenLicence = await anon
        .from("customer_private_profile")
        .select("licence_number")
        .eq("customer_id", customerId);
      expect(hiddenLicence.data ?? []).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});
