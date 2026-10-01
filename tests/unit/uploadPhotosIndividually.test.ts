import { describe, expect, it, vi } from "vitest";
import {
  PHOTO_TOO_LARGE_TO_UPLOAD_MESSAGE,
  PHOTO_UPLOAD_CONNECTION_MESSAGE,
} from "@/lib/forms/photoUploadErrors";
import { SERVER_ACTION_UPLOAD_MAX_BYTES } from "@/lib/forms/uploadLimits";
import {
  describeUploadOutcome,
  uploadPhotosIndividually,
} from "@/lib/forms/uploadPhotosIndividually";

function photo(name: string, size = 1_000): File {
  return new File([new Uint8Array(size)], name, { type: "image/jpeg" });
}

const noSleep = async () => undefined;

describe("uploadPhotosIndividually", () => {
  it("makes one action call per photo, in order", async () => {
    const seen: string[] = [];
    const outcome = await uploadPhotosIndividually(
      [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")],
      async (file) => {
        seen.push(file.name);
        return { error: null };
      },
      { sleep: noSleep }
    );

    expect(seen).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(outcome).toMatchObject({ total: 3, uploaded: 3, failed: 0, error: null });
  });

  it("refuses an oversize photo locally and still uploads the rest", async () => {
    const run = vi.fn(async () => ({ error: null }));
    const big = photo("big.jpg", SERVER_ACTION_UPLOAD_MAX_BYTES + 1);

    const outcome = await uploadPhotosIndividually([photo("ok.jpg"), big], run, {
      sleep: noSleep,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(outcome.uploaded).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.error).toMatch(/over the 4 MB upload limit/);
    expect(outcome.results[1]?.error).toMatch(/4.5 MB|4 MB/);
  });

  it("translates thrown framework errors instead of surfacing them raw", async () => {
    const outcome = await uploadPhotosIndividually(
      [photo("a.jpg")],
      async () => {
        throw new Error("413 FUNCTION_PAYLOAD_TOO_LARGE");
      },
      { sleep: noSleep }
    );

    expect(outcome.failed).toBe(1);
    expect(outcome.error).toBe(PHOTO_TOO_LARGE_TO_UPLOAD_MESSAGE);
  });

  it("retries transient network failures for a single photo", async () => {
    let attempts = 0;
    const outcome = await uploadPhotosIndividually(
      [photo("a.jpg")],
      async () => {
        attempts += 1;
        if (attempts < 2) throw new TypeError("Failed to fetch");
        return { error: null };
      },
      { sleep: noSleep }
    );

    expect(attempts).toBe(2);
    expect(outcome).toMatchObject({ uploaded: 1, failed: 0, error: null });
  });

  it("reports the connection message when retries run out", async () => {
    const outcome = await uploadPhotosIndividually(
      [photo("a.jpg")],
      async () => {
        throw new TypeError("Failed to fetch");
      },
      { sleep: noSleep, attempts: 2 }
    );

    expect(outcome.error).toBe(PHOTO_UPLOAD_CONNECTION_MESSAGE);
  });

  it("does not retry permanent server-side validation errors", async () => {
    const run = vi.fn(async () => ({ error: "Use a JPEG, PNG, WebP, or HEIC image." }));
    const outcome = await uploadPhotosIndividually([photo("a.jpg")], run, {
      sleep: noSleep,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(outcome.error).toMatch(/JPEG/);
  });
});

describe("describeUploadOutcome", () => {
  const base = { total: 3, uploaded: 3, failed: 0, error: null, results: [] };

  it("counts successes", () => {
    expect(describeUploadOutcome({ ...base, total: 1, uploaded: 1 }, "proof photo")).toBe(
      "Proof photo uploaded."
    );
    expect(describeUploadOutcome(base, "proof photo")).toBe("3 proof photos uploaded.");
  });

  it("explains partial and total failures with the reason", () => {
    expect(
      describeUploadOutcome(
        { ...base, uploaded: 2, failed: 1, error: "Too big." },
        "proof photo"
      )
    ).toBe("2 of 3 proof photos uploaded. Too big.");
    expect(
      describeUploadOutcome(
        { ...base, uploaded: 0, failed: 3, error: "Offline." },
        "document"
      )
    ).toBe("None of the 3 documents uploaded. Offline.");
    expect(
      describeUploadOutcome(
        { ...base, total: 1, uploaded: 0, failed: 1, error: "Offline." },
        "document"
      )
    ).toBe("Offline.");
  });
});
