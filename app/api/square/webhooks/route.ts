import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { processSquareWebhookEvent } from "@/lib/services/squareBilling";
import { isSquareConfigured } from "@/lib/square/config";
import { shouldSkipIntegrationEvent } from "@/lib/square/webhookDecisions";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { isUndefinedTableError } from "@/lib/database/schemaCompat";
import {
  getPublicRequestUrl,
  verifySquareWebhookSignature,
} from "@/lib/security/webhooks";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";

type IntegrationEventTracker = {
  markProcessed: () => Promise<void>;
  markFailed: (message: string) => Promise<void>;
};

/**
 * Idempotency ledger for provider events, keyed (provider, external_event_id):
 * - an existing 'processed' row means replay → acknowledge without work;
 * - 'failed'/'processing'/'received' rows are retried;
 * - rows are marked 'processed'/'failed' after the handler runs.
 * Returns null when we must skip processing; a no-op tracker when the table
 * is not migrated yet (legacy dedupe inside the processor still applies).
 */
async function trackIntegrationEvent(input: {
  eventId: string;
  eventType: string;
  objectId: string | null;
  payloadHash: string;
  requestId: string;
}): Promise<IntegrationEventTracker | null> {
  const noop: IntegrationEventTracker = {
    markProcessed: async () => {},
    markFailed: async () => {},
  };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return noop;
  }

  const { data: existing, error: readError } = await admin
    .from("integration_event")
    .select("integration_event_id, status, attempts")
    .eq("provider", "square")
    .eq("external_event_id", input.eventId)
    .maybeSingle();

  if (readError) {
    if (!isUndefinedTableError(readError)) {
      logger.warn("integration_event read failed", {
        requestId: input.requestId,
        error: readError.message,
      });
    }
    return noop;
  }

  if (shouldSkipIntegrationEvent(existing?.status)) {
    return null;
  }

  const attempts = Number(existing?.attempts ?? 0) + 1;
  const { error: upsertError } = await admin.from("integration_event").upsert(
    {
      provider: "square",
      external_event_id: input.eventId,
      object_type: "invoice",
      object_id: input.objectId,
      payload_hash: input.payloadHash,
      status: "processing",
      attempts,
      last_error: null,
    },
    { onConflict: "provider,external_event_id" }
  );
  if (upsertError) {
    logger.warn("integration_event upsert failed", {
      requestId: input.requestId,
      error: upsertError.message,
    });
    return noop;
  }

  const finalize = async (status: "processed" | "failed", lastError?: string) => {
    const { error } = await admin
      .from("integration_event")
      .update({
        status,
        last_error: lastError ?? null,
        ...(status === "processed" ? { processed_at: new Date().toISOString() } : {}),
      })
      .eq("provider", "square")
      .eq("external_event_id", input.eventId);
    if (error) {
      logger.warn("integration_event finalize failed", {
        requestId: input.requestId,
        error: error.message,
      });
    }
  };

  return {
    markProcessed: () => finalize("processed"),
    markFailed: (message: string) => finalize("failed", message.slice(0, 500)),
  };
}

export async function POST(request: Request) {
  const requestId = newRequestId();
  const ip = clientIp(request);
  const limited = rateLimit({
    key: `square-webhook:${ip}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isSquareConfigured()) {
    return NextResponse.json({ error: "Square is not configured" }, { status: 503 });
  }

  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim() ?? "";
  if (!signatureKey) {
    logger.error("Square webhook signature key missing", { requestId });
    return NextResponse.json(
      { error: "Webhook signature key not configured" },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-square-hmacsha256-signature");
  const notificationUrl = getPublicRequestUrl(request);

  if (
    !verifySquareWebhookSignature({
      rawBody,
      signatureHeader,
      signatureKey,
      notificationUrl,
    })
  ) {
    logger.warn("Square webhook signature rejected", { requestId, ip });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    type?: string;
    event_id?: string;
    eventId?: string;
    data?: Record<string, unknown>;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logger.warn("Square webhook payload unparsable", { requestId });
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const eventId = payload.event_id ?? payload.eventId ?? crypto.randomUUID();
  const invoiceObject = (
    payload.data as {
      object?: { invoice?: { id?: string } };
    } | null
  )?.object?.invoice;

  const tracker = await trackIntegrationEvent({
    eventId,
    eventType: payload.type ?? "unknown",
    objectId: invoiceObject?.id ?? null,
    payloadHash: createHash("sha256").update(rawBody, "utf8").digest("hex"),
    requestId,
  });

  if (!tracker) {
    logger.info("Square webhook replay acknowledged", { requestId, eventId });
    return NextResponse.json({ ok: true, deduped: true });
  }

  try {
    await processSquareWebhookEvent({
      type: payload.type ?? "unknown",
      event_id: eventId,
      data: payload.data ?? {},
    });
    await tracker.markProcessed();
    logger.info("Square webhook processed", {
      requestId,
      eventId,
      type: payload.type,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBHOOK_FAILED";
    await tracker.markFailed(message);
    captureException(error, { requestId, route: "square-webhook" });
    logger.error("Square webhook failed", { requestId, error: message });
    // 500 → Square retries; the integration_event row stays retryable.
    return NextResponse.json({ ok: false, error: "WEBHOOK_FAILED" }, { status: 500 });
  }
}
