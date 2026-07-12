/**
 * Paste into your Wix site's backend/http-functions.js (Velo).
 * Exposes POST /_functions/createInvoice for the OTOMOTO app.
 *
 * Requires:
 * - Wix Invoices / Billing enabled on the site
 * - Contact already exists (contactId + matching email)
 *
 * Set the same shared secret in WIX_INVOICE_HTTP_SECRET on the app.
 */

import { ok, badRequest, forbidden, serverError } from "wix-http-functions";
import { createInvoice } from "wix-billing-backend";

const SHARED_SECRET = "REPLACE_WITH_SAME_VALUE_AS_WIX_INVOICE_HTTP_SECRET";

export async function post_createInvoice(request) {
  try {
    const auth = request.headers["authorization"] || "";
    if (auth !== `Bearer ${SHARED_SECRET}`) {
      return forbidden({ body: { error: "Unauthorized" } });
    }

    const body = await request.body.json();
    if (!body?.contactId || !Array.isArray(body.lineItems) || !body.lineItems.length) {
      return badRequest({
        body: { error: "contactId and lineItems are required" },
      });
    }

    const lineItems = body.lineItems.map((item, index) => ({
      id: String(index + 1),
      name: item.name || "Service",
      description: item.description || "",
      price: Number(item.price) || 0,
      quantity: Number(item.quantity) || 1,
    }));

    const invoiceId = await createInvoice({
      title: body.title || body.workOrderNumber || "Service invoice",
      currency: body.currency || "CAD",
      customer: {
        contactId: body.contactId,
        email: body.email || body.customer?.email,
        firstName: body.customer?.firstName,
        lastName: body.customer?.lastName,
        phone: body.customer?.phone,
        fullName: [body.customer?.firstName, body.customer?.lastName]
          .filter(Boolean)
          .join(" "),
      },
      lineItems,
      metadata: {
        notes: body.workOrderNumber
          ? `OTOMOTO ${body.workOrderNumber}`
          : "OTOMOTO work order",
        source: "otomoto",
        sourceRefId: body.metadata?.work_order_id || "",
      },
      dates: {
        issueDate: new Date(),
        dueDate: new Date(),
      },
    });

    return ok({
      headers: { "Content-Type": "application/json" },
      body: {
        invoiceId,
        invoiceNumber: null,
      },
    });
  } catch (error) {
    return serverError({
      body: {
        error: error?.message || "WIX_INVOICE_CREATE_FAILED",
      },
    });
  }
}
