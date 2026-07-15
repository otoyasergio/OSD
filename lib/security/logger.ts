/**
 * Structured JSON logger for webhooks, cron, and server paths.
 * Compatible with Vercel log drains and Sentry breadcrumbs.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const entry = {
    level,
    message,
    ts: new Date().toISOString(),
    requestId: context?.requestId,
    ...context,
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export const logger = {
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};

export function newRequestId(): string {
  return crypto.randomUUID();
}
