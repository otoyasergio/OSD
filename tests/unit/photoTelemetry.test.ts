import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PHOTO_TELEMETRY_EVENT_NAMES,
  bucketPhotoAge,
  bucketPhotoLatency,
  emitPhotoTelemetry,
  resetPhotoTelemetrySink,
  setPhotoTelemetrySink,
  type PhotoTelemetryEvent,
} from "@/lib/photos/telemetry";

const LEAKS = [
  "https://signed.example/intake/front.jpg?token=abc",
  "sk-live-secret-token",
  "IMG_1234.HEIC",
  "wo/front/photo.jpg",
  "41111111-1111-4111-8111-111111111111",
  "customer-42",
  "VIN 2HESA1234",
  "Failed to fetch from storage",
];

function leaked(value: unknown): string[] {
  const serialized = JSON.stringify(value);
  return LEAKS.filter((leak) => serialized.includes(leak));
}

describe("photo telemetry", () => {
  afterEach(() => {
    resetPhotoTelemetrySink();
  });

  it("exposes the required event names", () => {
    expect(PHOTO_TELEMETRY_EVENT_NAMES).toEqual([
      "photo_prepare_failed",
      "photo_queue_quota_failed",
      "photo_queue_resumed",
      "photo_queue_retry",
      "photo_upload_confirmed",
      "photo_thumbnail_failed",
      "photo_reconciliation_summary",
    ]);
  });

  it("emits only allowed fields for each event", () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);

    const events: PhotoTelemetryEvent[] = [
      { name: "photo_prepare_failed", surface: "composer", errorCode: "unreadable" },
      { name: "photo_queue_quota_failed", surface: "photos_tab" },
      { name: "photo_queue_resumed", pendingCount: 3, oldestAgeBucket: "1_5m" },
      { name: "photo_queue_retry", settledFailureCount: 2, retryable: true },
      { name: "photo_upload_confirmed", latencyBucket: "1_3s", category: "front" },
      { name: "photo_thumbnail_failed", stage: "upload", statusClass: "5xx" },
      {
        name: "photo_reconciliation_summary",
        counts: {
          rows: 4,
          objects: 5,
          missingOriginals: 2,
          missingThumbnails: 1,
          nullThumbnails: 1,
          orphans: 1,
          repaired: 1,
          failed: 1,
        },
      },
    ];

    for (const event of events) emitPhotoTelemetry(event);

    expect(sink).toHaveBeenCalledTimes(events.length);
    expect(sink.mock.calls.map((call) => call[0])).toEqual(events);
  });

  it("buckets latency and age instead of exact values", () => {
    expect(bucketPhotoLatency(400)).toBe("lt_1s");
    expect(bucketPhotoLatency(1_500)).toBe("1_3s");
    expect(bucketPhotoLatency(8_000)).toBe("3_10s");
    expect(bucketPhotoLatency(20_000)).toBe("10_30s");
    expect(bucketPhotoLatency(45_000)).toBe("gte_30s");

    expect(bucketPhotoAge(20_000)).toBe("lt_1m");
    expect(bucketPhotoAge(3 * 60_000)).toBe("1_5m");
    expect(bucketPhotoAge(10 * 60_000)).toBe("5_15m");
    expect(bucketPhotoAge(40 * 60_000)).toBe("15_60m");
    expect(bucketPhotoAge(2 * 60 * 60_000)).toBe("gte_1h");
  });

  it("discards unknown keys and redacts a malicious payload", () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);

    emitPhotoTelemetry({
      name: "photo_prepare_failed",
      surface: "composer",
      errorCode: "unreadable",
      filename: "IMG_1234.HEIC",
      url: "https://signed.example/intake/front.jpg?token=abc",
      token: "sk-live-secret-token",
      path: "wo/front/photo.jpg",
      workOrderId: "41111111-1111-4111-8111-111111111111",
      customerId: "customer-42",
      userId: "41111111-1111-4111-8111-111111111111",
      notes: "VIN 2HESA1234",
      error: "Failed to fetch from storage",
      file: new File(["bytes"], "IMG_1234.HEIC"),
      blob: new Blob(["bytes"]),
    } as PhotoTelemetryEvent & Record<string, unknown>);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({
      name: "photo_prepare_failed",
      surface: "composer",
      errorCode: "unreadable",
    });
    expect(leaked(sink.mock.calls)).toEqual([]);
  });

  it("maps unknown surfaces, categories, and error codes to safe fallbacks", () => {
    const sink = vi.fn();
    setPhotoTelemetrySink(sink);

    emitPhotoTelemetry({
      name: "photo_prepare_failed",
      surface: "https://signed.example/intake/front.jpg?token=abc" as never,
      errorCode: "Failed to fetch from storage" as never,
    });
    emitPhotoTelemetry({
      name: "photo_upload_confirmed",
      latencyBucket: "1_3s",
      category: "wo/front/photo.jpg" as never,
    });

    expect(sink.mock.calls[0][0]).toEqual({
      name: "photo_prepare_failed",
      surface: "unknown",
      errorCode: "unknown",
    });
    expect(sink.mock.calls[1][0]).toEqual({
      name: "photo_upload_confirmed",
      latencyBucket: "1_3s",
      category: "other",
    });
    expect(leaked(sink.mock.calls)).toEqual([]);
  });

  it("swallows sink throw and rejection so callers keep working", async () => {
    setPhotoTelemetrySink(() => {
      throw new Error("Failed to fetch from storage https://signed.example/token=abc");
    });
    expect(() =>
      emitPhotoTelemetry({
        name: "photo_queue_quota_failed",
        surface: "photos_tab",
      })
    ).not.toThrow();

    setPhotoTelemetrySink(() => Promise.reject(new Error("IMG_1234.HEIC")));
    expect(() =>
      emitPhotoTelemetry({
        name: "photo_queue_quota_failed",
        surface: "photos_tab",
      })
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
