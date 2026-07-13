"use client";

import { useActionState } from "react";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { subscribeSmsAction, type SmsSubscribeState } from "@/app/sms/actions";
import { SmsConsentFields } from "@/components/sms/SmsConsentFields";

type SmsSubscribeFormProps = {
  privacyUrl: string | null;
  termsUrl: string | null;
};

export function SmsSubscribeForm({ privacyUrl, termsUrl }: SmsSubscribeFormProps) {
  const [state, formAction] = useActionState<SmsSubscribeState, FormData>(
    subscribeSmsAction,
    { error: null, success: false }
  );

  if (state.success) {
    return (
      <p className="rounded border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-3 text-sm text-[var(--status-success)]">
        You are subscribed. Reply STOP anytime to opt out.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <TextField label="Mobile phone" name="phone" type="tel" required />

      <SmsConsentFields privacyUrl={privacyUrl} termsUrl={termsUrl} />

      <FormError message={state.error} />

      <SubmitButton
        label="Subscribe"
        pendingLabel="Subscribing…"
        variant="accent"
        className="w-full text-base"
      />
    </form>
  );
}
