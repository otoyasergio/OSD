import { describe, expect, it, vi } from "vitest";
import {
  assertIntakePhotoObjectsAbsent,
  assertIntakePhotoRemoved,
  findIntakePhotosByNote,
  removeIntakePhotoArtifacts,
  type IsolatedIntakePhotoRow,
} from "@/tests/e2e/fixtures/safariPhotoIsolation";

const ROW: IsolatedIntakePhotoRow = {
  photo_id: "photo-1",
  storage_path: "wo/other/photo-1.jpg",
  thumb_storage_path: "wo/other/photo-1.thumb.jpg",
};

function createAdmin(options?: {
  rows?: IsolatedIntakePhotoRow[];
  remaining?: IsolatedIntakePhotoRow | null;
  downloadError?: { message: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options?.remaining ?? null,
    error: null,
  });
  const secondEq = vi.fn().mockResolvedValue({
    data: options?.rows ?? [ROW],
    error: null,
  });
  const firstEq = vi.fn().mockReturnValue({
    eq: secondEq,
    maybeSingle,
  });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const download = vi.fn().mockResolvedValue({
    data: options?.downloadError === null ? new Blob() : null,
    error:
      options?.downloadError === undefined
        ? { message: "Object not found" }
        : options.downloadError,
  });
  const delIn = vi.fn().mockResolvedValue({ error: null });
  return {
    from: vi.fn((table: string) => {
      if (table !== "intake_photo") throw new Error(`unexpected table ${table}`);
      return {
        select: vi.fn().mockReturnValue({
          eq: firstEq,
        }),
        delete: vi.fn().mockReturnValue({
          in: delIn,
        }),
      };
    }),
    storage: {
      from: vi.fn((bucket: string) => {
        expect(bucket).toBe("intake-photos");
        return { remove, download };
      }),
    },
    remove,
    download,
    delIn,
    maybeSingle,
  };
}

describe("safari photo isolation cleanup", () => {
  it("finds leftover rows by unique note and work order", async () => {
    const admin = createAdmin({ rows: [ROW] });
    const rows = await findIntakePhotosByNote(
      admin as never,
      "work-order-1",
      "safari-photo-note"
    );
    expect(rows).toEqual([ROW]);
    expect(admin.from).toHaveBeenCalledWith("intake_photo");
  });

  it("removes exact original and thumb objects then the row", async () => {
    const admin = createAdmin();
    await removeIntakePhotoArtifacts(admin as never, [ROW]);
    expect(admin.remove).toHaveBeenCalledWith([
      "wo/other/photo-1.jpg",
      "wo/other/photo-1.thumb.jpg",
    ]);
    expect(admin.delIn).toHaveBeenCalledWith("photo_id", ["photo-1"]);
  });

  it("asserts the happy-path delete left no row or object", async () => {
    const admin = createAdmin({ remaining: null });
    await expect(assertIntakePhotoRemoved(admin as never, ROW)).resolves.toBeUndefined();
    expect(admin.maybeSingle).toHaveBeenCalled();
    expect(admin.download).toHaveBeenCalledWith("wo/other/photo-1.jpg");
    expect(admin.download).toHaveBeenCalledWith("wo/other/photo-1.thumb.jpg");
  });

  it("asserts leftover original and thumb object paths are gone after cleanup", async () => {
    const admin = createAdmin({ remaining: null });
    await expect(
      assertIntakePhotoObjectsAbsent(admin as never, [
        ROW.storage_path,
        ROW.thumb_storage_path!,
      ])
    ).resolves.toBeUndefined();
    expect(admin.download).toHaveBeenCalledWith("wo/other/photo-1.jpg");
    expect(admin.download).toHaveBeenCalledWith("wo/other/photo-1.thumb.jpg");
  });

  it("fails object-absence when a captured original or thumb is still downloadable", async () => {
    const admin = createAdmin({ downloadError: null });
    await expect(
      assertIntakePhotoObjectsAbsent(admin as never, [ROW.storage_path])
    ).rejects.toThrow(/still available/i);
  });

  it("fails the assertion when the row is still present", async () => {
    const admin = createAdmin({ remaining: ROW });
    await expect(assertIntakePhotoRemoved(admin as never, ROW)).rejects.toThrow(
      /still present|not removed/i
    );
  });
});
