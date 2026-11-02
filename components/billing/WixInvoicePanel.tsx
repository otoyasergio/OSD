"use client";

import { useState, useTransition } from "react";
import {
  answerSquareAskAction,
  listTerminalPaymentsAction,
  publishWixInvoiceAction,
  voidAndSquareAction,
} from "@/app/(app)/work_orders/wix-invoice-actions";
import type { SquareAskItem } from "@/lib/services/wixInvoices";
import type { SquarePaymentListItem } from "@/lib/square/client";

function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100
  );
}

export function WixInvoicePanel({
  workOrderId,
  displayNumber,
  statusLabel,
  totalCents,
  payUrl,
  canManage,
  sent = false,
  asks,
}: {
  workOrderId: string;
  displayNumber: string | null;
  statusLabel: string | null;
  totalCents: number | null;
  payUrl: string | null;
  canManage: boolean;
  sent?: boolean;
  asks: SquareAskItem[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [offlineDollars, setOfflineDollars] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [terminals, setTerminals] = useState<SquarePaymentListItem[]>([]);
  const [pending, startTransition] = useTransition();
  const visitAsks = asks.filter((ask) => ask.work_order_id === workOrderId);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-white p-4">
      <h2 className="text-lg font-semibold">Wix invoice</h2>
      {displayNumber ? (
        <p className="mt-1 text-sm">
          {displayNumber}
          {statusLabel ? ` · ${statusLabel}` : ""}
          {totalCents != null ? ` · ${money(totalCents)}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-sm text-[var(--status-neutral)]">No Wix invoice on this visit yet.</p>
      )}
      {payUrl ? (
        <a href={payUrl} className="mt-2 inline-block text-sm underline" target="_blank" rel="noreferrer">
          Customer pay link
        </a>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {canManage && (statusLabel === "Draft" || (statusLabel === "Published" && !sent)) ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await publishWixInvoiceAction(workOrderId, dueDate || null);
              setError(result.error);
            });
          }}
        >
          <label className="text-sm">
            Due date
            <input
              type="date"
              className="mt-1 block rounded border px-2 py-1"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
          <button type="submit" className="btn" disabled={pending}>
            {statusLabel === "Draft" ? "Publish and send" : "Send to customer"}
          </button>
        </form>
      ) : null}
      {canManage && displayNumber ? (
        <div className="mt-4 border-t pt-3">
          <h3 className="text-sm font-semibold">Square this visit</h3>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            PayPal on the Wix invoice is squared automatically. Cash, e-transfer, cheque, and a
            terminal payment void the Wix invoice and keep the Square record.
          </p>
          {visitAsks.map((ask) => (
            <div key={ask.wix_payment_id} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span>
                {ask.kind === "refund" ? "Refund" : "Payment"} {money(ask.amount_cents)} · {ask.method}
                {ask.square_status === "not_yet" ? " · Paid on Wix, not squared" : ""}
              </span>
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await answerSquareAskAction(ask.wix_payment_id, "yes");
                    setError(result.error);
                  })
                }
              >
                Yes
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await answerSquareAskAction(ask.wix_payment_id, "not_yet");
                    setError(result.error);
                  })
                }
              >
                Not yet
              </button>
            </div>
          ))}
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <button
              type="button"
              className="btn btn-secondary w-fit"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    setTerminals(await listTerminalPaymentsAction());
                  } catch (loadError) {
                    setError(loadError instanceof Error ? loadError.message : "Could not list payments.");
                  }
                })
              }
            >
              Load Square terminal payments
            </button>
            {terminals.length > 0 ? (
              <select
                className="rounded border px-2 py-1"
                value={terminalId}
                onChange={(event) => setTerminalId(event.target.value)}
              >
                <option value="">Choose the terminal payment</option>
                {terminals.map((payment) => (
                  <option key={payment.id} value={payment.id}>
                    {money(payment.amountCents)}
                    {payment.last4 ? ` · ${payment.last4}` : ""} {payment.createdAt ?? ""}
                  </option>
                ))}
              </select>
            ) : null}
            <label>
              Offline amount (cash, e-transfer, or cheque)
              <input
                className="mt-1 block rounded border px-2 py-1"
                inputMode="decimal"
                value={offlineDollars}
                onChange={(event) => setOfflineDollars(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn w-fit"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const dollars = Number(offlineDollars);
                  const result = await voidAndSquareAction(workOrderId, {
                    squarePaymentId: terminalId || null,
                    offlineAmountCents:
                      Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null,
                  });
                  setError(result.error);
                })
              }
            >
              Void Wix invoice and square
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
