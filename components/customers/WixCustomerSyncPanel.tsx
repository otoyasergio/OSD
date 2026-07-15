"use client";

import { useActionState } from "react";
import {
  pullCustomerFromWixAction,
  syncCustomerToWixAction,
  type WixCustomerFormState,
} from "@/app/(app)/customers/wix-actions";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

export function WixCustomerSyncPanel({
  customerId,
  wixContactId,
  configured,
  canSync,
}: {
  customerId: string;
  wixContactId: string | null;
  configured: boolean;
  canSync: boolean;
}) {
  const [pushState, pushAction] = useActionState(
    syncCustomerToWixAction.bind(null, customerId),
    { error: null, success: null } satisfies WixCustomerFormState
  );
  const [pullState, pullAction] = useActionState(
    pullCustomerFromWixAction.bind(null, customerId),
    { error: null, success: null } satisfies WixCustomerFormState
  );

  if (!canSync) return null;

  return (
    <section className="rounded border border-[var(--border)] bg-white p-4">
      <h2 className="text-lg font-semibold text-foreground">Wix contact</h2>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        {configured
          ? wixContactId
            ? `Linked to Wix contact ${wixContactId}.`
            : "Not linked yet. Sync to create or match a Wix contact by email/phone."
          : "Add WIX_API_KEY and WIX_SITE_ID on the server to enable sync."}
      </p>

      {configured ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={pushAction}>
            <SubmitButton label="Sync to Wix" pendingLabel="Syncing…" />
          </form>
          {wixContactId ? (
            <form action={pullAction}>
              <SubmitButton label="Pull from Wix" pendingLabel="Pulling…" />
            </form>
          ) : null}
        </div>
      ) : null}

      <FormError message={pushState.error ?? pullState.error} />
      {pushState.success || pullState.success ? (
        <p className="mt-2 text-sm text-emerald-700" role="status">
          {pushState.success ?? pullState.success}
        </p>
      ) : null}
    </section>
  );
}
