import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPhotoAdminClient } = vi.hoisted(() => ({
  createPhotoAdminClient: vi.fn(),
}));

vi.mock("@/lib/database/supabase-admin", () => ({
  createPhotoAdminClient,
}));

import {
  cleanupUnreferencedIntakePhotoObjects,
  cleanupUnreferencedIntakePhotoObjectsAsAdmin,
  isValidIntakePhotoCandidatePath,
} from "@/lib/photos/cleanupUnreferencedIntakePhotoObjects";

const WORK_ORDER_ID = "41111111-1111-4111-8111-111111111111";
const PHOTO_ID = "71111111-1111-4111-8111-111111111111";
const ORIGINAL = `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`;
const THUMB = `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`;

describe("isValidIntakePhotoCandidatePath", () => {
  it("accepts canonical original and thumb object paths", () => {
    expect(isValidIntakePhotoCandidatePath(ORIGINAL)).toBe(true);
    expect(isValidIntakePhotoCandidatePath(THUMB)).toBe(true);
  });

  it("rejects malformed, traversal, and extra-segment paths", () => {
    expect(isValidIntakePhotoCandidatePath("not-a-uuid/front/photo.jpg")).toBe(false);
    expect(isValidIntakePhotoCandidatePath(`${WORK_ORDER_ID}/front/../secret.jpg`)).toBe(
      false
    );
    expect(
      isValidIntakePhotoCandidatePath(`${WORK_ORDER_ID}/front/${PHOTO_ID}.png`)
    ).toBe(false);
    expect(
      isValidIntakePhotoCandidatePath(`${WORK_ORDER_ID}/front/extra/${PHOTO_ID}.jpg`)
    ).toBe(false);
    expect(isValidIntakePhotoCandidatePath("")).toBe(false);
  });
});

describe("cleanupUnreferencedIntakePhotoObjects", () => {
  it("removes only unreferenced valid original and thumb paths", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const findReferencedPaths = vi.fn(async () => []);
    const logFailure = vi.fn();

    await cleanupUnreferencedIntakePhotoObjects({
      paths: [ORIGINAL, THUMB, "evil/../path.jpg"],
      findReferencedPaths,
      remove,
      logFailure,
    });

    expect(findReferencedPaths).toHaveBeenCalledWith([ORIGINAL, THUMB]);
    expect(remove).toHaveBeenCalledWith([ORIGINAL, THUMB]);
    expect(logFailure).not.toHaveBeenCalled();
  });

  it("refuses to remove a path still referenced by any intake_photo row", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const winnerOriginal = `${WORK_ORDER_ID}/front/72222222-2222-4222-8222-222222222222.jpg`;

    await cleanupUnreferencedIntakePhotoObjects({
      paths: [ORIGINAL, winnerOriginal],
      findReferencedPaths: async () => [winnerOriginal],
      remove,
      logFailure: vi.fn(),
    });

    expect(remove).toHaveBeenCalledWith([ORIGINAL]);
    expect(remove).not.toHaveBeenCalledWith(expect.arrayContaining([winnerOriginal]));
  });

  it("preserves committed self objects when both candidate paths are referenced", async () => {
    const remove = vi.fn(async () => ({ error: null }));

    await cleanupUnreferencedIntakePhotoObjects({
      paths: [ORIGINAL, THUMB],
      findReferencedPaths: async () => [ORIGINAL, THUMB],
      remove,
      logFailure: vi.fn(),
    });

    expect(remove).not.toHaveBeenCalled();
  });

  it("privacy-safely logs a leftover orphan when admin remove fails", async () => {
    const logFailure = vi.fn();

    await expect(
      cleanupUnreferencedIntakePhotoObjects({
        paths: [ORIGINAL, THUMB],
        findReferencedPaths: async () => [],
        remove: async () => ({
          error: {
            message: "https://signed.example/private.jpg?token=abc",
            statusCode: 403,
          },
        }),
        logFailure,
        sleep: async () => undefined,
        retryAttempts: 1,
      })
    ).rejects.toThrow("PHOTO_UPLOAD_FAILED");

    expect(logFailure).toHaveBeenCalledWith({
      stage: "cleanup",
      pathCount: 2,
      statusCode: "403",
    });
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain("signed.example");
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain("token=abc");
  });
});

describe("cleanupUnreferencedIntakePhotoObjectsAsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses createPhotoAdminClient and never a user-scoped storage client", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const storageIn = vi.fn(async () => ({ data: [], error: null }));
    const thumbIn = vi.fn(async () => ({ data: [], error: null }));
    createPhotoAdminClient.mockReturnValue({
      from: (table: string) => {
        expect(table).toBe("intake_photo");
        return {
          select: (columns: string) => {
            if (
              columns.includes("thumb_storage_path") &&
              !columns.includes("storage_path,")
            ) {
              return { in: thumbIn };
            }
            return { in: storageIn };
          },
        };
      },
      storage: { from: () => ({ remove }) },
    });

    await cleanupUnreferencedIntakePhotoObjectsAsAdmin([ORIGINAL, THUMB]);

    expect(createPhotoAdminClient).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([ORIGINAL, THUMB]);
  });

  it("surfaces PHOTO_ADMIN_MISCONFIGURED when the service role is missing", async () => {
    createPhotoAdminClient.mockImplementation(() => {
      throw new Error("PHOTO_ADMIN_MISCONFIGURED");
    });

    await expect(
      cleanupUnreferencedIntakePhotoObjectsAsAdmin([ORIGINAL])
    ).rejects.toThrow("PHOTO_ADMIN_MISCONFIGURED");
  });

  it("does not remove objects when the admin reference lookup errors", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    createPhotoAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          in: async () => ({
            data: null,
            error: { message: "https://signed.example/rest?token=abc" },
          }),
        }),
      }),
      storage: { from: () => ({ remove }) },
    });

    await expect(
      cleanupUnreferencedIntakePhotoObjectsAsAdmin([ORIGINAL])
    ).rejects.toThrow(/PHOTO_ADMIN_MISCONFIGURED|PHOTO_UPLOAD_FAILED/);
    expect(remove).not.toHaveBeenCalled();
  });
});
