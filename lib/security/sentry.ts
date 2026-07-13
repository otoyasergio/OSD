/**
 * Optional Sentry integration. When NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN is set,
 * errors are forwarded. Otherwise falls back to structured console logging.
 */

import { logger } from "@/lib/security/logger";

const dsn =
  process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || "";

export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message, {
    ...context,
    stack: error instanceof Error ? error.stack : undefined,
  });

  if (!dsn) return;

  // Lazy dynamic import keeps the bundle light when Sentry is not configured.
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(error, { extra: context });
    })
    .catch(() => {
      // Package may not be installed in all environments.
    });
}

export function isSentryConfigured(): boolean {
  return Boolean(dsn);
}
