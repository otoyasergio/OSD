import { describe, expect, it } from "vitest";
import { photoUploadQueueEnabled } from "@/lib/config/features";

describe("photoUploadQueueEnabled", () => {
  it("defaults to false so shops stay on the volatile in-session queue", () => {
    expect(photoUploadQueueEnabled({})).toBe(false);
    expect(photoUploadQueueEnabled({ PHOTO_UPLOAD_QUEUE_ENABLED: "" })).toBe(false);
    expect(photoUploadQueueEnabled({ PHOTO_UPLOAD_QUEUE_ENABLED: "0" })).toBe(false);
    expect(photoUploadQueueEnabled({ PHOTO_UPLOAD_QUEUE_ENABLED: "true" })).toBe(false);
  });

  it("is true only when PHOTO_UPLOAD_QUEUE_ENABLED=1", () => {
    expect(photoUploadQueueEnabled({ PHOTO_UPLOAD_QUEUE_ENABLED: "1" })).toBe(true);
  });

  it("stays independent of CHECKOUT_EVIDENCE_ENABLED", () => {
    expect(
      photoUploadQueueEnabled({
        CHECKOUT_EVIDENCE_ENABLED: "1",
        PHOTO_UPLOAD_QUEUE_ENABLED: "",
      })
    ).toBe(false);
    expect(
      photoUploadQueueEnabled({
        CHECKOUT_EVIDENCE_ENABLED: "0",
        PHOTO_UPLOAD_QUEUE_ENABLED: "1",
      })
    ).toBe(true);
  });
});
