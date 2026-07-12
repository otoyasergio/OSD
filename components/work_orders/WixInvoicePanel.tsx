"use client";

import { useActionState } from "react";
import {
  createWixInvoiceAction,
  type WixInvoiceFormState,
} from "@/app/(app)/work_orders/wix-actions";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

export function WixInvoicePanel({
  workOrderId,
  status,
  externalInvoiceNumber,
  wixInvoiceId,
  configured,
  canCreate,
  readOnly,
}: {
  workOrderId: string;
  status: string;
  externalInvoiceNumber: string | null;
  wixInvoiceId: string | null;
  configured: boolean;
  canCreate: boolean;
  readOnly: boolean;
}) {
  const [state, action] = useActionState(
    createWixInvoiceAction.bind(null, workOrderId),
    { error: null, success: null } satisfies WixInvoiceFormState
  );

  const eligible = status === "ready_for_pickup" || status === "completed";
  const alreadyCreated = Boolean(wixInvoiceId);

  if (!canCreate && !alreadyCreated) return null;

  return (
    <section className="rounded border border-zinc-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-zinc-900">Wix payment link</h2>
      <p className="mt-1 text-sm text-zinc-600">
        {alreadyCreated
          ? `Linked Wix payment link${
              externalInvoiceNumber ? ` ${externalInvoiceNumber}` : ""
            }.`
          : configured
            ? eligible
              ? "Create a Wix payment link from billable jobs and parts on this work order."
              : "Available when the work order is ready for pickup or completed."
            : "Add WIX_API_KEY and WIX_SITE_ID on the server to enable."}
      </p>

      {!readOnly && canCreate && configured && eligible && !alreadyCreated ? (
        <form action={action} className="mt-3">
          <SubmitButton
            label="Create Wix payment link"
            pendingLabel="Creating…"
          />
        </form>
      ) : null}

      <FormError message={state.error} />
      {state.success ? (
        <p className="mt-2 text-sm text-emerald-700" role="status">
          {state.success}
        </p>
      ) : null}
    </section>
  );
}
