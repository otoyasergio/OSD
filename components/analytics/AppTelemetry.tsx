"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { shouldCollectPublicMetrics } from "@/lib/passport/publicRoute";

function filterAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  return shouldCollectPublicMetrics(event.url) ? event : null;
}

function filterSpeedEvent<T extends { url: string }>(event: T): T | null {
  return shouldCollectPublicMetrics(event.url) ? event : null;
}

export function AppTelemetry() {
  return (
    <>
      <Analytics beforeSend={filterAnalyticsEvent} />
      <SpeedInsights beforeSend={filterSpeedEvent} />
    </>
  );
}
