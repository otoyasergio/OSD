"use client";

import { useActionState } from "react";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import type { InvoiceCheck } from "@/lib/purchasing/controls";
import type { OpenPartForOrder, PurchaseOrderView } from "@/lib/services/purchasing";
import {
  confirmPartFitmentAction,
  createPurchaseOrderAction,
  receivePurchaseLineAction,
  recordSupplierInvoiceAction,
  recordSupplierReturnAction,
  type PurchasingFormState,
} from "@/app/(app)/parts/purchasing-actions";

const blank: PurchasingFormState = { error: null, saved: false };

const INVOICE_LABEL: Record<InvoiceCheck, string> = {
  unset: "No supplier invoice yet",
  match: "Invoice matches received cost plus freight",
  mismatch: "Invoice does not match received cost plus freight",
  cost_missing: "Invoice is recorded. A line is still missing unit cost",
};

function money(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100
  );
}

function shopDate(iso: string | null): string {
  if (!iso) return "No expected date";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
  }).format(new Date(iso));
}

function CreateOrderForm({ parts }: { parts: OpenPartForOrder[] }) {
  const [state, action] = useActionState(createPurchaseOrderAction, blank);
  return (
    <form action={action} className="card card-pad space-y-3">
      <h2 className="font-semibold text-foreground">Send a purchase order</h2>
      <p className="text-sm text-[var(--status-neutral)]">
        Receiving a line creates an install task for the technician. It does not tell the
        customer the motorcycle is ready.
      </p>
      <FormError message={state.error} />
      {state.saved ? <p className="text-sm">Purchase order saved.</p> : null}
      {parts.length === 0 ? (
        <p className="text-sm text-[var(--status-neutral)]">
          No parts are waiting to be ordered.
        </p>
      ) : (
        <ul className="space-y-2">
          {parts.map((part) => (
            <li key={part.part_id}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="part_id"
                  value={part.part_id}
                  className="mt-1"
                />
                <span>
                  {part.part_name} · qty {part.quantity} · {part.work_order_number} ·{" "}
                  {part.status}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Supplier" name="supplier" required />
        <TextField label="Supplier PO number" name="external_po_number" />
        <TextField label="Expected on" name="expected_on" type="date" />
        <TextField
          label="Unit cost (dollars)"
          name="unit_cost_dollars"
          type="number"
          min="0"
          step="0.01"
          required
        />
      </div>
      <SubmitButton label="Create purchase order" pendingLabel="Saving…" />
    </form>
  );
}

function ReceiveForm({ poLineId }: { poLineId: string }) {
  const [state, action] = useActionState(receivePurchaseLineAction, blank);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="po_line_id" value={poLineId} />
      <TextField
        label="Receive qty"
        name="quantity"
        type="number"
        min="1"
        step="1"
        required
      />
      <SubmitButton label="Receive" pendingLabel="Saving…" />
      <FormError message={state.error} />
    </form>
  );
}

function ReturnForm({ poLineId }: { poLineId: string }) {
  const [state, action] = useActionState(recordSupplierReturnAction, blank);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-4 sm:items-end">
      <input type="hidden" name="po_line_id" value={poLineId} />
      <TextField
        label="Returned qty"
        name="quantity_returned"
        type="number"
        min="0"
        step="1"
        required
      />
      <TextField
        label="Supplier credit (dollars)"
        name="credit_dollars"
        type="number"
        min="0"
        step="0.01"
      />
      <TextField label="Core deadline" name="core_deadline" type="date" />
      <SubmitButton label="Record return" pendingLabel="Saving…" />
      <div className="sm:col-span-4">
        <FormError message={state.error} />
      </div>
    </form>
  );
}

function FitmentForm({
  requirementId,
  confirmedAt,
}: {
  requirementId: string;
  confirmedAt: string | null;
}) {
  const [state, action] = useActionState(confirmPartFitmentAction, blank);
  if (confirmedAt) {
    return <p className="text-sm">Fitment confirmed by a person.</p>;
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requirement_id" value={requirementId} />
      <p className="text-sm text-[var(--status-neutral)]">
        Catalogue fitment is a hint until someone confirms it.
      </p>
      <SubmitButton label="Confirm fitment" pendingLabel="Saving…" />
      <FormError message={state.error} />
    </form>
  );
}

function InvoiceForm({ order }: { order: PurchaseOrderView }) {
  const [state, action] = useActionState(recordSupplierInvoiceAction, blank);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-4 sm:items-end">
      <input type="hidden" name="purchase_order_id" value={order.purchase_order_id} />
      <TextField
        label="Supplier invoice"
        name="invoice_number"
        defaultValue={order.supplier_invoice_number ?? ""}
      />
      <TextField
        label="Invoice total (dollars)"
        name="invoice_total_dollars"
        type="number"
        min="0"
        step="0.01"
        required
        defaultValue={
          order.supplier_invoice_total_cents == null
            ? ""
            : String(order.supplier_invoice_total_cents / 100)
        }
      />
      <TextField
        label="Freight (dollars)"
        name="freight_dollars"
        type="number"
        min="0"
        step="0.01"
        defaultValue={String(order.freight_cents / 100)}
      />
      <SubmitButton label="Save invoice" pendingLabel="Saving…" />
      <p className="text-sm text-[var(--status-neutral)] sm:col-span-4">
        {INVOICE_LABEL[order.invoice_check]}
        {state.saved ? " Saved." : ""}
      </p>
      <div className="sm:col-span-4">
        <FormError message={state.error} />
      </div>
    </form>
  );
}

export function PurchasingDesk({
  parts,
  orders,
}: {
  parts: OpenPartForOrder[];
  orders: PurchaseOrderView[];
}) {
  return (
    <section className="space-y-4">
      <CreateOrderForm parts={parts} />
      {orders.length === 0 ? (
        <p className="card card-pad text-sm text-[var(--status-neutral)]">
          No purchase orders yet.
        </p>
      ) : (
        orders.map((order) => (
          <article key={order.purchase_order_id} className="card card-pad space-y-4">
            <div>
              <h2 className="font-semibold text-foreground">
                {order.supplier}
                {order.external_po_number ? ` · ${order.external_po_number}` : ""}
              </h2>
              <p className="text-sm text-[var(--status-neutral)]">
                {order.status} · expected {shopDate(order.expected_at)}
              </p>
            </div>
            <InvoiceForm order={order} />
            <ul className="space-y-4">
              {order.lines.map((line) => (
                <li
                  key={line.po_line_id}
                  className="space-y-2 border-t border-[var(--border)] pt-3"
                >
                  <p className="text-sm font-medium">
                    {line.description} · ordered {line.quantity_ordered} · received{" "}
                    {line.quantity_received} · returned {line.quantity_returned}
                    {line.unit_cost_cents != null
                      ? ` · cost ${money(line.unit_cost_cents)}`
                      : ""}
                    {line.supplier_credit_cents > 0
                      ? ` · credit ${money(line.supplier_credit_cents)}`
                      : ""}
                  </p>
                  {line.install_task_id ? (
                    <p className="text-sm text-[var(--status-neutral)]">
                      Install task is on the technician’s list.
                    </p>
                  ) : null}
                  <ReceiveForm poLineId={line.po_line_id} />
                  <ReturnForm poLineId={line.po_line_id} />
                  {line.requirement_id ? (
                    <FitmentForm
                      requirementId={line.requirement_id}
                      confirmedAt={line.fitment_confirmed_at}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </article>
        ))
      )}
    </section>
  );
}
