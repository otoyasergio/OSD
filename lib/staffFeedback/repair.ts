import { zipSync, strToU8 } from "fflate";
import { STAFF_FEEDBACK_SUMMARY_MAX } from "@/lib/staffFeedback/constants";
import {
  buildStaffFeedbackArchive,
  staffFeedbackArchivePath,
  type StaffFeedbackArchiveReport,
} from "@/lib/staffFeedback/squish";

/** Leave a fresh upload alone. A note can still be saving. */
export const STAFF_FEEDBACK_ORPHAN_GRACE_MS = 2 * 60 * 60 * 1000;

const SCREENSHOT_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
const ARCHIVE_PATH = /^digests\/\d{4}-\d{2}-\d{2}\.zip$/;

export type StaffFeedbackRepairCounts = {
  archivesRebuilt: number;
  archivesFailed: number;
  loosePicturesRemoved: number;
  orphanPicturesRemoved: number;
};

export const EMPTY_STAFF_FEEDBACK_REPAIR: StaffFeedbackRepairCounts = {
  archivesRebuilt: 0,
  archivesFailed: 0,
  loosePicturesRemoved: 0,
  orphanPicturesRemoved: 0,
};

export type StaffFeedbackStoredDigest = {
  digestId: string;
  shopDate: string;
  archivePath: string;
  summary: string;
};

export function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function isStaffFeedbackManagedPath(path: string): boolean {
  const normalized = path.trim().toLowerCase();
  return SCREENSHOT_PATH.test(normalized) || ARCHIVE_PATH.test(normalized);
}

/**
 * Pictures and zips with no row, old enough that the upload is not still in progress.
 * Anything else stays, including a path this bucket does not own.
 */
export function selectUnreferencedStaffFeedbackObjects(input: {
  objects: { path: string; createdAt: string }[];
  referencedPaths: ReadonlySet<string>;
  now: Date;
  graceMs?: number;
}): string[] {
  const grace = input.graceMs ?? STAFF_FEEDBACK_ORPHAN_GRACE_MS;
  const referenced = new Set(
    [...input.referencedPaths].map((path) => path.trim().toLowerCase())
  );
  const cutoff = input.now.getTime() - grace;
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const object of input.objects) {
    const path = object.path.trim();
    const key = path.toLowerCase();
    if (
      !path ||
      seen.has(key) ||
      !isStaffFeedbackManagedPath(key) ||
      referenced.has(key)
    ) {
      continue;
    }
    const created = Date.parse(object.createdAt);
    if (!Number.isFinite(created) || created > cutoff) continue;
    seen.add(key);
    selected.push(path);
  }

  return selected;
}

/** A night whose notes remain in the database but whose pictures are already gone. */
export function staffFeedbackSummaryArchive(
  summary: string,
  shopDate: string
): Uint8Array {
  staffFeedbackArchivePath(shopDate);
  const text = summary.trim();
  if (!text || text.length > STAFF_FEEDBACK_SUMMARY_MAX) {
    throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");
  }
  return zipSync({ "manifest.txt": strToU8(text) }, { level: 9 });
}

export async function repairStaffFeedbackStorage(input: {
  now: Date;
  digests: StaffFeedbackStoredDigest[];
  archiveExists(archivePath: string): Promise<boolean>;
  reportsForDigest(digestId: string): Promise<StaffFeedbackArchiveReport[]>;
  putArchive(archivePath: string, bytes: Uint8Array): Promise<void>;
  recordArchive(digestId: string, archiveBytes: number, summary: string): Promise<void>;
  clearLoosePictures(): Promise<number>;
  listObjects(): Promise<{ path: string; createdAt: string }[]>;
  referencedPaths(paths: string[]): Promise<Iterable<string>>;
  removeObjects(paths: string[]): Promise<void>;
}): Promise<StaffFeedbackRepairCounts> {
  const counts: StaffFeedbackRepairCounts = { ...EMPTY_STAFF_FEEDBACK_REPAIR };

  for (const digest of input.digests) {
    let expectedPath = "";
    try {
      expectedPath = staffFeedbackArchivePath(digest.shopDate);
    } catch {
      continue;
    }
    if (digest.archivePath !== expectedPath) continue;

    try {
      if (await input.archiveExists(digest.archivePath)) continue;
      const reports = await input.reportsForDigest(digest.digestId);
      if (reports.length > 0) {
        const archive = buildStaffFeedbackArchive(reports, digest.shopDate);
        await input.putArchive(digest.archivePath, archive.bytes);
        await input.recordArchive(
          digest.digestId,
          archive.bytes.byteLength,
          archive.summary
        );
      } else {
        const summary = digest.summary.trim();
        if (!summary) continue;
        const bytes = staffFeedbackSummaryArchive(summary, digest.shopDate);
        await input.putArchive(digest.archivePath, bytes);
        await input.recordArchive(digest.digestId, bytes.byteLength, summary);
      }
      counts.archivesRebuilt += 1;
    } catch {
      counts.archivesFailed += 1;
    }
  }

  counts.loosePicturesRemoved = await input.clearLoosePictures();

  const objects = await input.listObjects();
  const referenced = new Set(
    await input.referencedPaths(objects.map((object) => object.path))
  );
  const orphans = selectUnreferencedStaffFeedbackObjects({
    objects,
    referencedPaths: referenced,
    now: input.now,
  });
  if (orphans.length > 0) {
    await input.removeObjects(orphans);
    counts.orphanPicturesRemoved = orphans.length;
  }

  return counts;
}
