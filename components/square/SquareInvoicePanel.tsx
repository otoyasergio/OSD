"use client";

import { useState, useTransition } from "react";
import { createSquareInvoiceAction } from "@/app/(app)/work_orders/square-actions";
import { FormError } from "@/components/forms/Field";

type Props = {
  workOrderId: string;
  squareInvoiceId: string | null;
  squarePaymentStatus: string | null;
  canManage: boolean;
  readOnly?: boolean;
};

export function SquareInvoicePanel({
  workOrderId,
  squareInvoiceId,
  squarePaymentStatus,
  canManage,
  readOnly = false,
}: Props) {
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (readOnly || !canManage) {
    return squareInvoiceId ? (
      <p className="text-sm text-zinc-600">
        Square invoice: {squareInvoiceId} · {squarePaymentStatus ?? "unknown"}
      </p>
    ) : null;
  }

  function createInvoice() {
    setError(null);
    startTransition(async () => {
      const result = await createSquareInvoiceAction(workOrderId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPublicUrl(result.publicUrl ?? null);
    });
  }

  return (
    <div className="card card-pad flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
        Square payment
      </h3>
      {squareInvoiceId ? (
        <p className="text-sm">
          Invoice <code className="text-xs">{squareInvoiceId}</code> · Status:{" "}
          <strong>{squarePaymentStatus ?? "unpaid"}</strong>
        </p>
      ) : (
        <p className="text-sm text-zinc-600">
          Create a Square invoice from approved jobs and priced parts when the work order is
          ready for pickup.
        </p>
      )}
      {publicUrl ? (
        <a href={publicUrl} target="_blank" rel="noreferrer" className="btn btn-primary self-start">
          Open payment link
        </a>
      ) : null}
      {!squareInvoiceId ? (
        <button
          type="button"
          className="btn btn-primary self-start"
          disabled={pending}
          onClick={createInvoice}
        >
          {pending ? "Creating…" : "Create Square invoice"}
        </button>
      ) : null}
      {error ? <FormError message={error} /> : null}
    </div>
  );
}
