import { describe, expect, it } from "vitest";
import {
  PHOTO_TELEMETRY_EVENT_NAMES,
  sanitizePhotoTelemetryEvent,
} from "@/lib/photos/telemetry";

const IDENTIFIERS = {
  workOrderId: "41111111-1111-4111-8111-111111111111",
  userId: "51111111-1111-4111-8111-111111111111",
  photoId: "61111111-1111-4111-8111-111111111111",
  filename: "IMG_1234.HEIC",
  notes: "VIN 2HESA1234 tank scratch",
  url: "https://signed.example/intake/front.jpg?token=abc",
};

describe("photo telemetry event schemas", () => {
  it("rejects identifier and free-text fields on every known event", () => {
    for (const name of PHOTO_TELEMETRY_EVENT_NAMES) {
      const sanitized = sanitizePhotoTelemetryEvent({
        name,
        surface: "photos_tab",
        errorCode: "unreadable",
        pendingCount: 1,
        oldestAgeBucket: "lt_1m",
        settledFailureCount: 1,
        retryable: true,
        latencyBucket: "lt_1s",
        category: "front",
        stage: "upload",
        statusClass: "5xx",
        counts: {
          rows: 1,
          objects: 1,
          missingOriginals: 0,
          missingThumbnails: 0,
          nullThumbnails: 0,
          orphans: 0,
          repaired: 0,
          failed: 0,
        },
        ...IDENTIFIERS,
      });
      expect(sanitized, name).not.toBeNull();
      const serialized = JSON.stringify(sanitized);
      for (const leak of Object.values(IDENTIFIERS)) {
        expect(serialized, `${name} leaked ${leak}`).not.toContain(leak);
      }
    }
  });

  it("rejects unknown event names and free-text payloads", () => {
    expect(
      sanitizePhotoTelemetryEvent({
        name: "photo_customer_named_IMG_1234",
        message: "Failed to fetch VIN 2HESA1234",
        ...IDENTIFIERS,
      })
    ).toBeNull();
    expect(sanitizePhotoTelemetryEvent("VIN 2HESA1234")).toBeNull();
    expect(sanitizePhotoTelemetryEvent(null)).toBeNull();
  });
});
