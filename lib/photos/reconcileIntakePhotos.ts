import { makeCanonicalIntakeThumbnail } from "@/lib/photos/canonicalizeIntakePhoto";
import { intakeThumbStoragePath } from "@/lib/photos/makeIntakeThumb";
import { INTAKE_PHOTO_BUCKET } from "@/lib/photos/signedUrls";

export type PhotoReconcileRow = {
  photo_id: string;
  storage_path: string;
  thumb_storage_path: string | null;
};

export type StorageListItem = {
  name: string;
  id: string | null;
};

export type PhotoReconcileReport = {
  missingOriginals: Array<{ photoId: string; storagePath: string }>;
  missingThumbnails: Array<{ photoId: string; thumbStoragePath: string }>;
  nullThumbnails: Array<{ photoId: string; storagePath: string }>;
  orphans: Array<{ path: string }>;
  repaired: number;
  failed: number;
  failures: Array<{ photoId: string; reason: string }>;
  counts: {
    rows: number;
    objects: number;
    missingOriginals: number;
    missingThumbnails: number;
    nullThumbnails: number;
    orphans: number;
    repaired: number;
    failed: number;
  };
};

export type PhotoReconcileDependencies = {
  listPhotoPage(offset: number, limit: number): Promise<PhotoReconcileRow[]>;
  listStoragePage(
    prefix: string,
    offset: number,
    limit: number
  ): Promise<StorageListItem[]>;
  downloadObject?(path: string): Promise<Uint8Array>;
  uploadObject?(input: {
    path: string;
    bytes: Uint8Array;
    contentType: string;
    upsert: false;
  }): Promise<void>;
  updateThumbStoragePath?(photoId: string, thumbPath: string): Promise<void>;
  generateThumbnail?(bytes: Uint8Array): Promise<Uint8Array>;
  removeObject?(path: string): Promise<void>;
};

export type PhotoReconcileOptions = {
  repairThumbnails?: boolean;
  pageSize?: number;
  concurrency?: number;
};

const DEFAULT_PAGE_SIZE = 1000;
const MAX_REPAIR_CONCURRENCY = 2;

async function paginateAll<T>(
  listPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize: number
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await listPage(offset, pageSize);
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function listAllObjectPaths(
  listStoragePage: PhotoReconcileDependencies["listStoragePage"],
  pageSize: number
): Promise<string[]> {
  const objects: string[] = [];

  async function listPrefix(prefix: string): Promise<void> {
    let offset = 0;
    for (;;) {
      const page = await listStoragePage(prefix, offset, pageSize);
      if (page.length === 0) break;
      for (const item of page) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id == null) {
          await listPrefix(path);
        } else {
          objects.push(path);
        }
      }
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }

  await listPrefix("");
  return objects;
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
}

export function sortPhotoReconcileReport(
  report: PhotoReconcileReport
): PhotoReconcileReport {
  return {
    missingOriginals: [...report.missingOriginals].sort(
      (a, b) =>
        a.photoId.localeCompare(b.photoId) || a.storagePath.localeCompare(b.storagePath)
    ),
    missingThumbnails: [...report.missingThumbnails].sort(
      (a, b) =>
        a.photoId.localeCompare(b.photoId) ||
        a.thumbStoragePath.localeCompare(b.thumbStoragePath)
    ),
    nullThumbnails: [...report.nullThumbnails].sort(
      (a, b) =>
        a.photoId.localeCompare(b.photoId) || a.storagePath.localeCompare(b.storagePath)
    ),
    orphans: [...report.orphans].sort((a, b) => a.path.localeCompare(b.path)),
    repaired: report.repaired,
    failed: report.failed,
    failures: [...report.failures].sort((a, b) => a.photoId.localeCompare(b.photoId)),
    counts: { ...report.counts },
  };
}

export async function reconcileIntakePhotos(
  deps: PhotoReconcileDependencies,
  options: PhotoReconcileOptions = {}
): Promise<PhotoReconcileReport> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const repairThumbnails = options.repairThumbnails === true;
  const concurrency = Math.min(
    MAX_REPAIR_CONCURRENCY,
    Math.max(1, options.concurrency ?? MAX_REPAIR_CONCURRENCY)
  );

  const rows = await paginateAll(deps.listPhotoPage, pageSize);
  const objectPaths = await listAllObjectPaths(deps.listStoragePage, pageSize);
  const objects = new Set(objectPaths);
  const referenced = new Set<string>();
  for (const row of rows) {
    referenced.add(row.storage_path);
    if (row.thumb_storage_path) referenced.add(row.thumb_storage_path);
  }

  const missingOriginals: PhotoReconcileReport["missingOriginals"] = [];
  const missingThumbnails: PhotoReconcileReport["missingThumbnails"] = [];
  const nullThumbnails: PhotoReconcileReport["nullThumbnails"] = [];
  const generateJobs: PhotoReconcileRow[] = [];
  const pointerJobs: Array<{ photoId: string; thumbPath: string }> = [];

  for (const row of rows) {
    const originalMissing = !objects.has(row.storage_path);
    if (originalMissing) {
      missingOriginals.push({ photoId: row.photo_id, storagePath: row.storage_path });
    }
    if (row.thumb_storage_path == null) {
      nullThumbnails.push({ photoId: row.photo_id, storagePath: row.storage_path });
    } else if (!objects.has(row.thumb_storage_path)) {
      missingThumbnails.push({
        photoId: row.photo_id,
        thumbStoragePath: row.thumb_storage_path,
      });
    }

    if (!repairThumbnails || originalMissing) continue;
    const deterministicThumb = intakeThumbStoragePath(row.storage_path);
    if (row.thumb_storage_path == null && objects.has(deterministicThumb)) {
      pointerJobs.push({ photoId: row.photo_id, thumbPath: deterministicThumb });
      continue;
    }
    if (
      (row.thumb_storage_path == null && !objects.has(deterministicThumb)) ||
      (row.thumb_storage_path != null && !objects.has(row.thumb_storage_path))
    ) {
      generateJobs.push(row);
    }
  }

  let repaired = 0;
  let failed = 0;
  const failures: PhotoReconcileReport["failures"] = [];

  if (repairThumbnails) {
    for (const job of pointerJobs) {
      try {
        if (!deps.updateThumbStoragePath) throw new Error("update");
        await deps.updateThumbStoragePath(job.photoId, job.thumbPath);
        repaired += 1;
      } catch {
        failed += 1;
        failures.push({ photoId: job.photoId, reason: "update" });
      }
    }

    await mapLimit(generateJobs, concurrency, async (row) => {
      try {
        if (!deps.downloadObject || !deps.generateThumbnail || !deps.uploadObject) {
          throw new Error("generate");
        }
        const bytes = await deps.downloadObject(row.storage_path);
        const thumbnail = await deps.generateThumbnail(bytes);
        const thumbPath = intakeThumbStoragePath(row.storage_path);
        await deps.uploadObject({
          path: thumbPath,
          bytes: thumbnail,
          contentType: "image/jpeg",
          upsert: false,
        });
        if (!deps.updateThumbStoragePath) throw new Error("update");
        await deps.updateThumbStoragePath(row.photo_id, thumbPath);
        repaired += 1;
      } catch {
        failed += 1;
        failures.push({ photoId: row.photo_id, reason: "generate" });
      }
    });
  }

  const orphans = objectPaths
    .filter((path) => !referenced.has(path))
    .map((path) => ({ path }));

  return sortPhotoReconcileReport({
    missingOriginals,
    missingThumbnails,
    nullThumbnails,
    orphans,
    repaired,
    failed,
    failures,
    counts: {
      rows: rows.length,
      objects: objectPaths.length,
      missingOriginals: missingOriginals.length,
      missingThumbnails: missingThumbnails.length,
      nullThumbnails: nullThumbnails.length,
      orphans: orphans.length,
      repaired,
      failed,
    },
  });
}

export type PhotoReconcileClient = {
  from(table: string): {
    select(columns: string): {
      order(column: string): {
        range(
          from: number,
          to: number
        ): PromiseLike<{
          data: PhotoReconcileRow[] | null;
          error: { message?: string } | null;
        }>;
      };
    };
    update(values: { thumb_storage_path: string }): {
      eq(
        column: string,
        value: string
      ): PromiseLike<{ error: { message?: string } | null }>;
    };
  };
  storage: {
    from(bucket: string): {
      list(
        prefix: string,
        options: { limit: number; offset: number }
      ): PromiseLike<{
        data: Array<{ name: string; id: string | null }> | null;
        error: { message?: string } | null;
      }>;
      download(path: string): PromiseLike<{
        data: Blob | ArrayBuffer | Uint8Array | null;
        error: { message?: string } | null;
      }>;
      upload(
        path: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: false }
      ): PromiseLike<{ error: { message?: string } | null }>;
    };
  };
};

async function bytesFromDownload(
  data: Blob | ArrayBuffer | Uint8Array | null
): Promise<Uint8Array> {
  if (!data) throw new Error("download");
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

export function createPhotoReconcileDependencies(
  client: PhotoReconcileClient
): PhotoReconcileDependencies {
  const bucket = client.storage.from(INTAKE_PHOTO_BUCKET);
  return {
    async listPhotoPage(offset, limit) {
      const { data, error } = await client
        .from("intake_photo")
        .select("photo_id, storage_path, thumb_storage_path")
        .order("photo_id")
        .range(offset, offset + limit - 1);
      if (error) throw new Error(error.message ?? "list");
      return data ?? [];
    },
    async listStoragePage(prefix, offset, limit) {
      const { data, error } = await bucket.list(prefix, { limit, offset });
      if (error) throw new Error(error.message ?? "list");
      return (data ?? []).map((item) => ({ name: item.name, id: item.id }));
    },
    async downloadObject(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw new Error(error?.message ?? "download");
      return bytesFromDownload(data);
    },
    async uploadObject(input) {
      const { error } = await bucket.upload(input.path, input.bytes, {
        contentType: input.contentType,
        upsert: false,
      });
      if (error) throw new Error(error.message ?? "upload");
    },
    async updateThumbStoragePath(photoId, thumbPath) {
      const { error } = await client
        .from("intake_photo")
        .update({ thumb_storage_path: thumbPath })
        .eq("photo_id", photoId);
      if (error) throw new Error(error.message ?? "update");
    },
    async generateThumbnail(bytes) {
      return makeCanonicalIntakeThumbnail(bytes);
    },
  };
}

export async function reconcileIntakePhotosWithClient(
  client: PhotoReconcileClient,
  options: { repairThumbnails?: boolean } = {}
): Promise<PhotoReconcileReport> {
  return reconcileIntakePhotos(createPhotoReconcileDependencies(client), {
    repairThumbnails: options.repairThumbnails === true,
  });
}
