import Link from "next/link";
import type { BillingBoardItem } from "@/lib/services/billingBoard";
import { BILLING_BUCKET_LABELS } from "@/lib/billing/buckets";
import { EmptyState } from "@/components/ui/EmptyState";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BillingLedgerTable({ items }: { items: BillingBoardItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No billing activity"
        description="Work orders with estimates or invoices appear here."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-600">
          <tr>
            <th className="px-3 py-3 font-semibold">WO</th>
            <th className="px-3 py-3 font-semibold">Customer</th>
            <th className="px-3 py-3 font-semibold">Bike</th>
            <th className="px-3 py-3 font-semibold">Stage</th>
            <th className="px-3 py-3 font-semibold">Payment</th>
            <th className="px-3 py-3 font-semibold">Estimate</th>
            <th className="px-3 py-3 font-semibold">Collected</th>
            <th className="px-3 py-3 font-semibold">Remaining</th>
            <th className="px-3 py-3 font-semibold">Square</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.work_order_id} className="border-b border-zinc-100">
              <td className="px-3 py-3">
                <Link href={item.href} className="data-table-link font-semibold">
                  {item.work_order_number}
                </Link>
              </td>
              <td className="px-3 py-3">{item.customer_label}</td>
              <td className="px-3 py-3">{item.motorcycle_label}</td>
              <td className="px-3 py-3">
                {BILLING_BUCKET_LABELS[item.bucket]}
                <span className="block text-xs text-zinc-500">
                  {item.billing_stage}
                </span>
              </td>
              <td className="px-3 py-3">{item.square_payment_status ?? "—"}</td>
              <td className="px-3 py-3">{money(item.estimate_cents)}</td>
              <td className="px-3 py-3">{money(item.billing_collected_cents)}</td>
              <td className="px-3 py-3">{money(item.remaining_cents)}</td>
              <td className="px-3 py-3">
                {item.square_invoice_public_url ? (
                  <a
                    href={item.square_invoice_public_url}
                    target="_blank"
                    rel="noreferrer"
                    className="data-table-link"
                  >
                    Link
                  </a>
                ) : item.square_invoice_id ? (
                  <code className="text-xs">{item.square_invoice_id.slice(0, 10)}…</code>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
