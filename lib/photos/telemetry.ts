import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { logger } from "@/lib/security/logger";

export const PHOTO_TELEMETRY_EVENT_NAMES = [
  "photo_prepare_failed",
  "photo_queue_quota_failed",
  "photo_queue_resumed",
  "photo_queue_retry",
  "photo_upload_confirmed",
  "photo_thumbnail_failed",
  "photo_reconciliation_summary",
] as const;

export type PhotoTelemetryEventName = (typeof PHOTO_TELEMETRY_EVENT_NAMES)[number];

export const PHOTO_TELEMETRY_SURFACES = [
  "composer",
  "profile",
  "customer_documents",
  "staff_documents",
  "motorcycle_documents",
  "photos_tab",
  "inspection",
  "floor",
  "diagnostics",
  "intake",
  "paper_agreement",
  "unknown",
] as const;

export type PhotoTelemetrySurface = (typeof PHOTO_TELEMETRY_SURFACES)[number];

export const PHOTO_PREPARE_ERROR_CODES = [
  "empty",
  "unreadable",
  "invalid_type",
  "unknown",
] as const;

export type PhotoPrepareErrorCode = (typeof PHOTO_PREPARE_ERROR_CODES)[number];

export const PHOTO_AGE_BUCKETS = ["lt_1m", "1_5m", "5_15m", "15_60m", "gte_1h"] as const;
export type PhotoAgeBucket = (typeof PHOTO_AGE_BUCKETS)[number];

export const PHOTO_LATENCY_BUCKETS = [
  "lt_1s",
  "1_3s",
  "3_10s",
  "10_30s",
  "gte_30s",
] as const;
export type PhotoLatencyBucket = (typeof PHOTO_LATENCY_BUCKETS)[number];

export const PHOTO_THUMBNAIL_STAGES = ["generate", "upload"] as const;
export type PhotoThumbnailStage = (typeof PHOTO_THUMBNAIL_STAGES)[number];

export const PHOTO_STATUS_CLASSES = ["2xx", "4xx", "5xx", "unknown"] as const;
export type PhotoStatusClass = (typeof PHOTO_STATUS_CLASSES)[number];

export type PhotoReconciliationCounts = {
  rows: number;
  objects: number;
  missingOriginals: number;
  missingThumbnails: number;
  nullThumbnails: number;
  orphans: number;
  repaired: number;
  failed: number;
};

export type PhotoTelemetryEvent =
  | {
      name: "photo_prepare_failed";
      surface: PhotoTelemetrySurface;
      errorCode: PhotoPrepareErrorCode;
    }
  | { name: "photo_queue_quota_failed"; surface: PhotoTelemetrySurface }
  | {
      name: "photo_queue_resumed";
      pendingCount: number;
      oldestAgeBucket: PhotoAgeBucket;
    }
  | {
      name: "photo_queue_retry";
      settledFailureCount: number;
      retryable: boolean;
    }
  | {
      name: "photo_upload_confirmed";
      latencyBucket: PhotoLatencyBucket;
      category: string;
    }
  | {
      name: "photo_thumbnail_failed";
      stage: PhotoThumbnailStage;
      statusClass: PhotoStatusClass;
    }
  | { name: "photo_reconciliation_summary"; counts: PhotoReconciliationCounts };

export type PhotoTelemetrySink = (event: PhotoTelemetryEvent) => void | Promise<void>;

const SURFACE_SET = new Set<string>(PHOTO_TELEMETRY_SURFACES);
const ERROR_CODE_SET = new Set<string>(PHOTO_PREPARE_ERROR_CODES);
const AGE_SET = new Set<string>(PHOTO_AGE_BUCKETS);
const LATENCY_SET = new Set<string>(PHOTO_LATENCY_BUCKETS);
const STAGE_SET = new Set<string>(PHOTO_THUMBNAIL_STAGES);
const STATUS_SET = new Set<string>(PHOTO_STATUS_CLASSES);
const CATEGORY_SET = new Set<string>([...Object.keys(PHOTO_CATEGORY_LABELS), "other"]);
const EVENT_NAME_SET = new Set<string>(PHOTO_TELEMETRY_EVENT_NAMES);
const COUNT_KEYS = [
  "rows",
  "objects",
  "missingOriginals",
  "missingThumbnails",
  "nullThumbnails",
  "orphans",
  "repaired",
  "failed",
] as const;

let sink: PhotoTelemetrySink | null = defaultPhotoTelemetrySink;

export function photoTelemetryUsesSentry(name: PhotoTelemetryEventName): boolean {
  return (
    name === "photo_prepare_failed" ||
    name === "photo_queue_quota_failed" ||
    name === "photo_queue_retry" ||
    name === "photo_thumbnail_failed"
  );
}

function defaultPhotoTelemetrySink(event: PhotoTelemetryEvent): void {
  logger.info(event.name, event);
  if (!photoTelemetryUsesSentry(event.name)) return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureMessage(event.name, { level: "info", extra: { ...event } });
    })
    .catch(() => undefined);
}

export function setPhotoTelemetrySink(next: PhotoTelemetrySink | null): void {
  sink = next;
}

export function resetPhotoTelemetrySink(): void {
  sink = defaultPhotoTelemetrySink;
}

export function bucketPhotoLatency(ms: number): PhotoLatencyBucket {
  if (!Number.isFinite(ms) || ms < 1_000) return "lt_1s";
  if (ms < 3_000) return "1_3s";
  if (ms < 10_000) return "3_10s";
  if (ms < 30_000) return "10_30s";
  return "gte_30s";
}

export function bucketPhotoAge(ms: number): PhotoAgeBucket {
  if (!Number.isFinite(ms) || ms < 60_000) return "lt_1m";
  if (ms < 5 * 60_000) return "1_5m";
  if (ms < 15 * 60_000) return "5_15m";
  if (ms < 60 * 60_000) return "15_60m";
  return "gte_1h";
}

export function safePhotoTelemetrySurface(value: unknown): PhotoTelemetrySurface {
  return typeof value === "string" && SURFACE_SET.has(value)
    ? (value as PhotoTelemetrySurface)
    : "unknown";
}

export function safePhotoPrepareErrorCode(value: unknown): PhotoPrepareErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value)
    ? (value as PhotoPrepareErrorCode)
    : "unknown";
}

export function safePhotoCategory(value: unknown): string {
  return typeof value === "string" && CATEGORY_SET.has(value) ? value : "other";
}

export function safePhotoStatusClass(statusCode?: string): PhotoStatusClass {
  const numeric = Number(statusCode);
  if (Number.isFinite(numeric) && numeric >= 200 && numeric < 300) return "2xx";
  if (Number.isFinite(numeric) && numeric >= 400 && numeric < 500) return "4xx";
  if (Number.isFinite(numeric) && numeric >= 500 && numeric < 600) return "5xx";
  return "unknown";
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeCounts(value: unknown): PhotoReconciliationCounts | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const counts = {} as PhotoReconciliationCounts;
  for (const key of COUNT_KEYS) {
    const next = asFiniteNumber(source[key]);
    if (next == null) return null;
    counts[key] = next;
  }
  return counts;
}

export function sanitizePhotoTelemetryEvent(raw: unknown): PhotoTelemetryEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const name = input.name;
  if (typeof name !== "string" || !EVENT_NAME_SET.has(name)) return null;

  switch (name) {
    case "photo_prepare_failed":
      return {
        name,
        surface: safePhotoTelemetrySurface(input.surface),
        errorCode: safePhotoPrepareErrorCode(input.errorCode),
      };
    case "photo_queue_quota_failed":
      return { name, surface: safePhotoTelemetrySurface(input.surface) };
    case "photo_queue_resumed": {
      const pendingCount = asFiniteNumber(input.pendingCount);
      const oldestAgeBucket =
        typeof input.oldestAgeBucket === "string" && AGE_SET.has(input.oldestAgeBucket)
          ? (input.oldestAgeBucket as PhotoAgeBucket)
          : null;
      if (pendingCount == null || !oldestAgeBucket) return null;
      return { name, pendingCount, oldestAgeBucket };
    }
    case "photo_queue_retry": {
      const settledFailureCount = asFiniteNumber(input.settledFailureCount);
      if (settledFailureCount == null || typeof input.retryable !== "boolean")
        return null;
      return { name, settledFailureCount, retryable: input.retryable };
    }
    case "photo_upload_confirmed": {
      const latencyBucket =
        typeof input.latencyBucket === "string" && LATENCY_SET.has(input.latencyBucket)
          ? (input.latencyBucket as PhotoLatencyBucket)
          : null;
      if (!latencyBucket) return null;
      return { name, latencyBucket, category: safePhotoCategory(input.category) };
    }
    case "photo_thumbnail_failed": {
      const stage =
        typeof input.stage === "string" && STAGE_SET.has(input.stage)
          ? (input.stage as PhotoThumbnailStage)
          : null;
      const statusClass =
        typeof input.statusClass === "string" && STATUS_SET.has(input.statusClass)
          ? (input.statusClass as PhotoStatusClass)
          : null;
      if (!stage || !statusClass) return null;
      return { name, stage, statusClass };
    }
    case "photo_reconciliation_summary": {
      const counts = sanitizeCounts(input.counts);
      if (!counts) return null;
      return { name, counts };
    }
    default:
      return null;
  }
}

export function emitPhotoTelemetry(raw: unknown): void {
  try {
    const event = sanitizePhotoTelemetryEvent(raw);
    if (!event || !sink) return;
    const result = sink(event);
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Telemetry must never break capture, upload, or reconciliation.
  }
}
