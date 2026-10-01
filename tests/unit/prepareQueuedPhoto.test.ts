import { describe, expect, it } from "vitest";
import {
  prepareQueuedPhoto,
  prepareQueuedPhotoFromBytes,
} from "@/lib/photos/uploadQueue/prepareQueuedPhoto";

describe("prepareQueuedPhotoFromBytes", () => {
  it("queues HEIC bytes without reading a File", async () => {
    const bytes = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const queued = prepareQueuedPhotoFromBytes({
      bytes,
      fileName: "sample.heic",
      mimeType: "image/heic",
      userId: "user-a",
      locationId: "location-a",
      category: "other",
      workOrderId: "wo-1",
      notes: "tank scratch",
      now: 10,
    });

    expect(queued.status).toBe("preparing");
    expect(queued.mimeType).toBe("image/heic");
    expect(queued.byteCount).toBe(bytes.byteLength);
    expect(queued.notes).toBe("tank scratch");
    expect(new Uint8Array(await queued.blob.arrayBuffer())).toEqual(bytes);
  });

  it("prepareQueuedPhoto still copies an existing File", async () => {
    const file = new File(["jpeg-bytes"], "front.jpg", { type: "image/jpeg" });
    const queued = await prepareQueuedPhoto({
      file,
      userId: "user-a",
      locationId: "location-a",
      category: "front",
      workOrderId: "wo-1",
      now: 11,
    });
    expect(queued.fileName).toBe("front.jpg");
    expect(queued.byteCount).toBe(file.size);
    expect(await queued.blob.text()).toBe("jpeg-bytes");
  });
});
