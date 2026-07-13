"use client";

import { useState, useTransition } from "react";
import type { PortalWorkOrderView } from "@/lib/services/portal";
import { portalUpdateSmsConsentAction } from "@/app/c/[token]/actions";
import { SmsConsentFields } from "@/components/sms/SmsConsentFields";
import { FormError } from "@/components/forms/Field";

type Props = {
  token: string;
  customer: PortalWorkOrderView["customer"];
  privacyUrl: string | null;
  termsUrl: string | null;
};

export function PortalSmsPrefs({ token, customer, privacyUrl, termsUrl }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  if (saved) {
    return (
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">Text message preferences</h2>
        <p className="text-sm text-emerald-700">Your text preferences have been saved.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Text message preferences</h2>
      {customer.sms_opted_out_at ? (
        <p className="mb-4 text-sm text-zinc-600">
          You previously opted out of text messages. Choose the types you want below to
          receive messages again.
        </p>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await portalUpdateSmsConsentAction(token, formData);
            setError(result.error);
            if (!result.error) {
              setSaved(true);
            }
          });
        }}
      >
        <SmsConsentFields
          privacyUrl={privacyUrl}
          termsUrl={termsUrl}
          defaultTransactional={Boolean(customer.sms_transactional_consent_at)}
          defaultMarketing={Boolean(customer.sms_marketing_consent_at)}
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </button>
        {error ? <FormError message={error} /> : null}
      </form>
    </section>
  );
}
