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
