import Link from "next/link";
import type { WixInvoiceListItem } from "@/lib/services/wixInvoices";

function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100
  );
}

export function WixInvoiceList({
  invoices,
  emptyLabel,
}: {
  invoices: WixInvoiceListItem[];
  emptyLabel: string;
}) {
  if (invoices.length === 0) {
    return <p className="text-sm text-[var(--status-neutral)]">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-y divide-[var(--border)] text-sm">
      {invoices.map((invoice) => (
        <li key={invoice.wix_invoice_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
          <span className="font-medium">{invoice.display_number}</span>
          <span>{invoice.status_label}</span>
          <span>{money(invoice.total_cents)}</span>
          <span>
            {invoice.issue_date
              ? new Date(invoice.issue_date).toLocaleDateString("en-CA", {
                  timeZone: "America/Toronto",
                })
              : "No issue date"}
          </span>
          <span>{invoice.vin_snapshot ?? "No VIN"}</span>
          {invoice.work_order_id ? (
            <Link
              href={`/work_orders/${invoice.work_order_id}`}
              className="underline underline-offset-2"
            >
              Work order
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
