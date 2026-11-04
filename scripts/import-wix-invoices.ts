/**
 * Import existing Wix invoices onto customers. Does not create work orders.
 * Links a work order only when its number equals the display number.
 * Paid invoices are stored and excluded from the square question.
 *
 * Refuses the production Supabase project unless IMPORT_WIX_INVOICES_CONFIRM=1.
 */
import { createAdminClient } from "@/lib/database/supabase-admin";
import { queryWixInvoices, queryWixInvoicesPage } from "@/lib/wix/invoiceClient";
import { upsertInvoiceFromRecord } from "@/lib/services/wixInvoices";
import type { WixInvoiceRecord } from "@/lib/wix/invoicePayload";

const PRODUCTION_REF = "eofxprepuajpqyvlolhw";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (url.includes(PRODUCTION_REF) && process.env.IMPORT_WIX_INVOICES_CONFIRM !== "1") {
  console.error(
    "Refusing to import into the production database. Set IMPORT_WIX_INVOICES_CONFIRM=1 only after the cutover list is accepted."
  );
  process.exit(1);
}

const admin = createAdminClient();
let cursor: string | undefined;
let imported = 0;
let page = 0;

async function take(invoices: WixInvoiceRecord[]) {
  for (const invoice of invoices) {
    const paid = (invoice.status ?? "").toUpperCase() === "PAID";
    await upsertInvoiceFromRecord(invoice, {
      excludeFromSquare: paid,
      createCustomer: true,
    });
    if (invoice.numbering?.displayNumber && invoice.id) {
      const { data: matches } = await admin
        .from("work_order")
        .select("work_order_id")
        .eq("work_order_number", invoice.numbering.displayNumber)
        .limit(2);
      if (matches?.length === 1) {
        await admin
          .from("wix_invoice")
          .update({ work_order_id: matches[0].work_order_id })
          .eq("wix_invoice_id", invoice.id);
      }
    }
    imported += 1;
  }
}

const first = await queryWixInvoices({}, 100);
await take(first.invoices);
cursor = first.pagingMetadata?.cursors?.next;
page += 1;

while (cursor && page < 80) {
  const next = await queryWixInvoicesPage(cursor, 100);
  await take(next.invoices);
  cursor = next.pagingMetadata?.hasNext ? next.pagingMetadata.cursors?.next : undefined;
  page += 1;
}

console.log(`Imported ${imported} Wix invoices across ${page} pages. No work orders were created.`);
