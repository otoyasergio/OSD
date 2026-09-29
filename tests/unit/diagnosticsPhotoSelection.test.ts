import { describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTICS_PHOTO_MAX_SELECTED,
  DIAGNOSTICS_PHOTO_PURPOSE_MAX,
  addPhotoSelection,
  buildPhotosPayload,
  createObjectUrlRegistry,
  defaultPhotoPurpose,
  isDiagnosticsPhotoEligible,
  parseUploadedAssistantPhoto,
  photoPromptFromMessages,
  photoRequestFromMessages,
  toDiagnosticsPhotoSourceRows,
  validatePhotoSelections,
  type DiagnosticsPhotoSourceRow,
} from "@/lib/diagnostics/photoSelection";
import { DIAGNOSTICS_TURN_TEXT_MAX } from "@/lib/diagnostics/turnLimits";
import {
  ASK_OTOMOTO_MAX_PHOTOS,
  ASK_OTOMOTO_MAX_TEXT_CHARS,
} from "@/lib/services/diagnosticsAssistant";
import type { IntakePhoto } from "@/lib/services/photos";

const WO = "41111111-1111-4111-8111-111111111111";
const OTHER_WO = "42222222-2222-4222-8222-222222222222";
const JOB = "51111111-1111-4111-8111-111111111111";
const OTHER_JOB = "52222222-2222-4222-8222-222222222222";

function photoId(n: number): string {
  return `a${n}111111-1111-4111-8111-111111111111`;
}

function row(
  overrides: Partial<DiagnosticsPhotoSourceRow> = {}
): DiagnosticsPhotoSourceRow {
  return {
    photo_id: photoId(1),
    work_order_id: WO,
    job_id: null,
    category: "inspection_tires",
    created_at: "2026-09-29T00:00:00.000Z",
    thumb_url: "https://signed.example/thumb.jpg",
    ...overrides,
  };
}

describe("isDiagnosticsPhotoEligible", () => {
  const scope = { workOrderId: WO, jobId: JOB };

  it.each([
    "inspection_tires",
    "inspection_brakes",
    "inspection_forks",
    "inspection_item",
  ])("allows %s for the same work order", (category) => {
    expect(isDiagnosticsPhotoEligible(row({ category: category as never }), scope)).toBe(
      true
    );
  });

  it.each(["job_work", "job_proof"])("allows %s only for the thread job", (category) => {
    expect(
      isDiagnosticsPhotoEligible(row({ category: category as never, job_id: JOB }), scope)
    ).toBe(true);
    expect(
      isDiagnosticsPhotoEligible(
        row({ category: category as never, job_id: OTHER_JOB }),
        scope
      )
    ).toBe(false);
    expect(
      isDiagnosticsPhotoEligible(
        row({ category: category as never, job_id: null }),
        scope
      )
    ).toBe(false);
  });

  it("rejects job photos for a work-order-only thread", () => {
    expect(
      isDiagnosticsPhotoEligible(row({ category: "job_work", job_id: JOB }), {
        workOrderId: WO,
        jobId: null,
      })
    ).toBe(false);
  });

  it("rejects inspection photos pinned to a different job than the thread", () => {
    expect(isDiagnosticsPhotoEligible(row({ job_id: OTHER_JOB }), scope)).toBe(false);
  });

  it.each([
    "vin",
    "odometer",
    "front",
    "rear",
    "left_side",
    "right_side",
    "damage",
    "accessories",
    "fuel_level",
    "other",
    "customer_id",
    "signature",
  ])("rejects %s", (category) => {
    expect(isDiagnosticsPhotoEligible(row({ category: category as never }), scope)).toBe(
      false
    );
  });

  it("rejects photos from another work order", () => {
    expect(isDiagnosticsPhotoEligible(row({ work_order_id: OTHER_WO }), scope)).toBe(
      false
    );
  });
});

describe("toDiagnosticsPhotoSourceRows", () => {
  it("keeps only eligible rows and strips storage paths, notes, and uploader identity", () => {
    const full = {
      photo_id: photoId(1),
      work_order_id: WO,
      uploaded_by_user_id: "u1",
      storage_path: `${WO}/job_work/secret.jpg`,
      thumb_storage_path: `${WO}/job_work/secret_thumb.jpg`,
      photo_url: "https://legacy.example/full.jpg",
      category: "job_work",
      notes: "Customer Jane Doe said it clicks",
      inspection_result_id: null,
      job_id: JOB,
      created_at: "2026-09-29T00:00:00.000Z",
      signed_url: "https://signed.example/full.jpg",
      thumb_url: "https://signed.example/thumb.jpg",
      uploaded_by: { user_id: "u1", first_name: "Sam", last_name: "Tech" },
    } as IntakePhoto;
    const vin = {
      ...full,
      photo_id: photoId(2),
      category: "vin",
      job_id: null,
    } as IntakePhoto;

    const rows = toDiagnosticsPhotoSourceRows([full, vin], {
      workOrderId: WO,
      jobId: JOB,
    });

    expect(rows).toEqual([
      {
        photo_id: photoId(1),
        work_order_id: WO,
        job_id: JOB,
        category: "job_work",
        created_at: "2026-09-29T00:00:00.000Z",
        thumb_url: "https://signed.example/thumb.jpg",
      },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/storage_path|Jane|Sam|legacy|full\.jpg/);
  });
});

describe("photo selection state", () => {
  const scope = { workOrderId: WO, jobId: JOB };

  it("starts empty and never auto-selects", () => {
    expect(validatePhotoSelections([])).toEqual({ ok: true, errors: [] });
    expect(buildPhotosPayload([])).toEqual([]);
  });

  it("adds explicit selections with a default purpose and caps at three", () => {
    let selections = [] as ReturnType<typeof addPhotoSelection>["selections"];
    for (let i = 1; i <= 4; i += 1) {
      const result = addPhotoSelection(selections, photoId(i), "Check this");
      selections = result.selections;
      if (i <= 3) expect(result.added).toBe(true);
      else {
        expect(result.added).toBe(false);
        expect(result.reason).toBe("limit");
      }
    }
    expect(selections).toHaveLength(DIAGNOSTICS_PHOTO_MAX_SELECTED);
    expect(DIAGNOSTICS_PHOTO_MAX_SELECTED).toBe(3);
  });

  it("does not add the same photo twice", () => {
    const first = addPhotoSelection([], photoId(1), "Look");
    const again = addPhotoSelection(first.selections, photoId(1), "Look");
    expect(again.added).toBe(false);
    expect(again.reason).toBe("duplicate");
    expect(again.selections).toHaveLength(1);
    void scope;
  });

  it("builds a payload of exactly {photoId, purpose} with trimmed purposes", () => {
    const payload = buildPhotosPayload([
      { photoId: photoId(1), purpose: "  Pad wear  " },
      { photoId: photoId(2), purpose: "Rotor edge" },
    ]);
    expect(payload).toEqual([
      { photoId: photoId(1), purpose: "Pad wear" },
      { photoId: photoId(2), purpose: "Rotor edge" },
    ]);
    for (const item of payload) {
      expect(Object.keys(item).sort()).toEqual(["photoId", "purpose"]);
    }
  });

  it("payload never carries extra fields such as URLs even when selections do", () => {
    const payload = buildPhotosPayload([
      {
        photoId: photoId(1),
        purpose: "Pad wear",
        previewUrl: "blob:local",
        thumb_url: "https://signed.example/t.jpg",
        storage_path: "x/y.jpg",
      } as never,
    ]);
    expect(JSON.stringify(payload)).toBe(
      JSON.stringify([{ photoId: photoId(1), purpose: "Pad wear" }])
    );
  });

  it("requires a non-blank purpose within the bound", () => {
    expect(validatePhotoSelections([{ photoId: photoId(1), purpose: "   " }]).ok).toBe(
      false
    );
    expect(
      validatePhotoSelections([
        { photoId: photoId(1), purpose: "x".repeat(DIAGNOSTICS_PHOTO_PURPOSE_MAX + 1) },
      ]).ok
    ).toBe(false);
    expect(
      validatePhotoSelections([
        { photoId: photoId(1), purpose: "x".repeat(DIAGNOSTICS_PHOTO_PURPOSE_MAX) },
      ]).ok
    ).toBe(true);
    expect(
      validatePhotoSelections(
        [photoId(1), photoId(2), photoId(3), photoId(4)].map((id) => ({
          photoId: id,
          purpose: "ok",
        }))
      ).ok
    ).toBe(false);
  });
});

describe("defaultPhotoPurpose and photoPromptFromMessages", () => {
  it("defaults to the requested photo prompt, bounded", () => {
    expect(defaultPhotoPurpose("Show the left caliper")).toBe("Show the left caliper");
    expect(defaultPhotoPurpose("y".repeat(900))).toHaveLength(
      DIAGNOSTICS_PHOTO_PURPOSE_MAX
    );
    expect(defaultPhotoPurpose(null)).toBe("Work photo for analysis");
    expect(defaultPhotoPurpose("   ")).toBe("Work photo for analysis");
  });

  const ready = (requestedInput: unknown, role = "assistant", status = "ready") => ({
    role,
    generationStatus: status,
    requestedInput,
  });

  it("reads the photo prompt only from the latest ready assistant message", () => {
    expect(
      photoPromptFromMessages([
        ready({ type: "photo", prompt: "Old prompt" }),
        ready({ type: "none", prompt: null }),
      ])
    ).toBeNull();
    expect(
      photoPromptFromMessages([
        ready({ type: "none", prompt: null }),
        ready({ type: "photo", prompt: "  Show the caliper  " }),
      ])
    ).toBe("Show the caliper");
  });

  it("ignores measurement/question/test prompts and malformed input", () => {
    expect(
      photoPromptFromMessages([ready({ type: "measurement", prompt: "Voltage?" })])
    ).toBeNull();
    expect(photoPromptFromMessages([ready("photo")])).toBeNull();
    expect(photoPromptFromMessages([ready({ type: "photo", prompt: 3 })])).toBeNull();
    expect(
      photoPromptFromMessages([
        ready({ type: "photo", prompt: "x" }, "assistant", "failed"),
      ])
    ).toBeNull();
  });

  it("does not offer a photo prompt when the technician already replied", () => {
    expect(
      photoPromptFromMessages([
        ready({ type: "photo", prompt: "Show it" }),
        ready(null, "user"),
      ])
    ).toBeNull();
  });
});

describe("createObjectUrlRegistry", () => {
  it("revokes individual and remaining URLs exactly once", () => {
    let n = 0;
    const create = vi.fn(() => `blob:${(n += 1)}`);
    const revoke = vi.fn();
    const registry = createObjectUrlRegistry({ create, revoke });

    const a = registry.create(new Blob(["a"]), "p1");
    const b = registry.create(new Blob(["b"]), "p2");
    expect(registry.get("p1")).toBe(a);
    registry.revoke("p1");
    registry.revoke("p1");
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(a);
    registry.revokeAll();
    registry.revokeAll();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenLastCalledWith(b);
    expect(registry.get("p2")).toBeNull();
  });

  it("revokes the previous URL when a key is replaced", () => {
    let n = 0;
    const revoke = vi.fn();
    const registry = createObjectUrlRegistry({
      create: () => `blob:${(n += 1)}`,
      revoke,
    });
    registry.create(new Blob(["a"]), "p1");
    registry.create(new Blob(["b"]), "p1");
    expect(revoke).toHaveBeenCalledWith("blob:1");
    expect(registry.get("p1")).toBe("blob:2");
  });
});

describe("client-safe limits mirror the server", () => {
  it("matches the service text and photo limits", () => {
    expect(DIAGNOSTICS_TURN_TEXT_MAX).toBe(ASK_OTOMOTO_MAX_TEXT_CHARS);
    expect(DIAGNOSTICS_PHOTO_MAX_SELECTED).toBe(ASK_OTOMOTO_MAX_PHOTOS);
  });
});

describe("photoRequestFromMessages", () => {
  const msg = (messageId: string, requestedInput: unknown, role = "assistant") => ({
    messageId,
    role,
    generationStatus: "ready",
    requestedInput,
  });

  it("returns a stable per-message key with the trimmed prompt", () => {
    expect(
      photoRequestFromMessages([msg("m1", { type: "photo", prompt: " Show it " })])
    ).toEqual({ key: "m1", prompt: "Show it" });
  });

  it("gives a new key when a later assistant message repeats the same prompt", () => {
    const first = photoRequestFromMessages([
      msg("m1", { type: "photo", prompt: "Show it" }),
    ]);
    const second = photoRequestFromMessages([
      msg("m1", { type: "photo", prompt: "Show it" }),
      msg("m2", null, "user"),
      msg("m3", { type: "photo", prompt: "Show it" }),
    ]);
    expect(first?.key).not.toBe(second?.key);
  });

  it("is null when nothing is requested", () => {
    expect(
      photoRequestFromMessages([msg("m1", { type: "none", prompt: null })])
    ).toBeNull();
    expect(photoRequestFromMessages([])).toBeNull();
  });
});

describe("parseUploadedAssistantPhoto", () => {
  const scope = { workOrderId: WO, jobId: JOB };
  const valid = {
    photoId: photoId(9),
    workOrderId: WO,
    jobId: JOB,
    category: "job_work",
    notes: "x",
    createdAt: "2026-09-29T15:00:00.000Z",
  };

  it("accepts a job_work photo for this work order and job", () => {
    expect(parseUploadedAssistantPhoto(valid, scope)).toEqual({
      photoId: photoId(9),
      category: "job_work",
      createdAt: "2026-09-29T15:00:00.000Z",
    });
  });

  it.each([
    ["non-object", "nope"],
    ["null", null],
    ["missing id", { ...valid, photoId: undefined }],
    ["non-uuid id", { ...valid, photoId: "not-a-uuid" }],
    ["wrong category", { ...valid, category: "vin" }],
    ["unknown category", { ...valid, category: "__proto__" }],
    ["other work order", { ...valid, workOrderId: OTHER_WO }],
    ["other job", { ...valid, jobId: OTHER_JOB }],
    ["no job", { ...valid, jobId: null }],
  ])("rejects %s", (_name, data) => {
    expect(parseUploadedAssistantPhoto(data, scope)).toBeNull();
  });

  it("rejects a WO-only thread scope", () => {
    expect(
      parseUploadedAssistantPhoto(valid, { workOrderId: WO, jobId: null })
    ).toBeNull();
  });
});

describe("whitespace normalization of photo prompts", () => {
  const messy = "  Show the\n left\tcaliper\r\n   piston  ";

  it("collapses all whitespace in the default purpose", () => {
    expect(defaultPhotoPurpose(messy)).toBe("Show the left caliper piston");
    expect(defaultPhotoPurpose("\n\t ")).toBe("Work photo for analysis");
  });

  it("bounds the purpose after collapsing whitespace", () => {
    expect(defaultPhotoPurpose(`a${" \n".repeat(600)}b`)).toBe("a b");
    const long = defaultPhotoPurpose("word\n".repeat(200));
    expect(long.length).toBeLessThanOrEqual(DIAGNOSTICS_PHOTO_PURPOSE_MAX);
    expect(long).toBe(long.trim());
    expect(long).not.toMatch(/\s{2}|\n/);
  });

  it("collapses whitespace in the displayed photo request prompt", () => {
    expect(
      photoRequestFromMessages([
        {
          messageId: "m1",
          role: "assistant",
          generationStatus: "ready",
          requestedInput: { type: "photo", prompt: messy },
        },
      ])
    ).toEqual({ key: "m1", prompt: "Show the left caliper piston" });
  });
});
