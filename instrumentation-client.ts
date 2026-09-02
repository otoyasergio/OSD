// Client-side Sentry init. Next.js 15.3+ loads this file on the browser;
// sentry.client.config.ts alone is only picked up by withSentryConfig, which
// this app intentionally does not use (no sourcemap upload step).
import * as Sentry from "@sentry/nextjs";

import "./sentry.client.config";

// Instruments App Router navigations once a DSN enables the SDK.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
