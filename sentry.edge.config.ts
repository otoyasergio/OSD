import * as Sentry from "@sentry/nextjs";
import { filterPassportSentryEvent } from "@/lib/passport/sentryPrivacy";

const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    enabled: process.env.NODE_ENV === "production",
    beforeSend: (event) => filterPassportSentryEvent(event),
    beforeSendTransaction: (event) => filterPassportSentryEvent(event),
  });
}
