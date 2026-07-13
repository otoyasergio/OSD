"use client";

import { useActionState } from "react";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { subscribeSmsAction, type SmsSubscribeState } from "@/app/sms/actions";

type SmsConsentFieldsProps = {
  privacyUrl: string | null;
  termsUrl: string | null;
  defaultTransactional?: boolean;
  defaultMarketing?: boolean;
};

export function SmsConsentFields({
  privacyUrl,
  termsUrl,
  defaultTransactional = false,
  defaultMarketing = false,
}: SmsConsentFieldsProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="field-label">Message types</legend>

      <label className="flex min-h-11 items-start gap-2 text-sm text-chrome-foreground">
        <input
          type="checkbox"
          name="sms_transactional"
          value="on"
          defaultChecked={defaultTransactional}
          className="mt-1 size-4"
        />
        <span>
          Service updates — appointment reminders, work order status, and shop
          notifications.
        </span>
      </label>

      <label className="flex min-h-11 items-start gap-2 text-sm text-chrome-foreground">
        <input
          type="checkbox"
          name="sms_marketing"
          value="on"
          defaultChecked={defaultMarketing}
          className="mt-1 size-4"
        />
        <span>Promotional offers — sales, events, and special announcements.</span>
      </label>

      <p className="text-xs leading-relaxed text-chrome-muted">
        By subscribing, you agree to receive text messages from Toronto Moto. Message
        frequency varies. Message and data rates may apply. Reply HELP for help or STOP to
        cancel.
        {privacyUrl ? (
          <>
            {" "}
            <a
              href={privacyUrl}
              className="underline underline-offset-2 hover:text-chrome-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy Policy
            </a>
          </>
        ) : null}
        {privacyUrl && termsUrl ? " and " : null}
        {termsUrl ? (
          <a
            href={termsUrl}
            className="underline underline-offset-2 hover:text-chrome-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            Terms
          </a>
        ) : null}
        {privacyUrl || termsUrl ? "." : null}
      </p>
    </fieldset>
  );
}

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
