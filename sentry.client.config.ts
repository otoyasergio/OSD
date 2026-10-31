// This file configures the initialization of Sentry on the client.
import * as Sentry from "@sentry/nextjs";
import { filterPassportSentryEvent } from "@/lib/passport/sentryPrivacy";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || process.env.SENTRY_DSN?.trim();
const currentUrl = () =>
  typeof window === "undefined" ? undefined : window.location.href;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    enabled: process.env.NODE_ENV === "production",
    beforeSend: (event) => filterPassportSentryEvent(event, currentUrl()),
    beforeSendTransaction: (event) => filterPassportSentryEvent(event, currentUrl()),
  });
}
