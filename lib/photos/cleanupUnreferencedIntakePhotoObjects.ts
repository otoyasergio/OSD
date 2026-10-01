import "server-only";

import { createPhotoAdminClient } from "@/lib/database/supabase-admin";
import { INTAKE_PHOTO_BUCKET } from "@/lib/photos/signedUrls";
import { removeIntakePhotoObjects } from "@/lib/photos/removeIntakePhotoObjects";
import type { IntakePhotoStorageRemoveError } from "@/lib/photos/removeIntakePhotoObjects";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CANDIDATE_PATH = new RegExp(
  `^${UUID}/[a-z][a-z0-9_]*/${UUID}(?:\\.thumb)?\\.jpg$`,
  "i"
);

export type CleanupFailureDetails = {
  stage: "cleanup";
  pathCount: number;
  statusCode?: string;
};

export type CleanupUnreferencedIntakePhotoObjectsInput = {
  paths: string[];
  findReferencedPaths(paths: string[]): Promise<Iterable<string>>;
  remove(paths: string[]): Promise<{ error: IntakePhotoStorageRemoveError }>;
  logFailure(details: CleanupFailureDetails): void;
  retryAttempts?: number;
  sleep?(ms: number): Promise<void>;
};

type ReferencedPathRow = {
  storage_path?: string | null;
  thumb_storage_path?: string | null;
};

type PhotoAdminClient = {
  from(table: string): {
    select(columns: string): {
      in(
        column: string,
        values: string[]
      ): Promise<{
        data: ReferencedPathRow[] | null;
        error: { message?: string | null } | null;
      }>;
    };
  };
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ error: IntakePhotoStorageRemoveError }>;
    };
  };
};

export function isValidIntakePhotoCandidatePath(path: string): boolean {
  return typeof path === "string" && !path.includes("..") && CANDIDATE_PATH.test(path);
}

export async function cleanupUnreferencedIntakePhotoObjects(
  input: CleanupUnreferencedIntakePhotoObjectsInput
): Promise<void> {
  const candidates = [...new Set(input.paths.filter(isValidIntakePhotoCandidatePath))];
  if (candidates.length === 0) return;

  let referenced: Set<string>;
  try {
    referenced = new Set(await input.findReferencedPaths(candidates));
  } catch {
    input.logFailure({ stage: "cleanup", pathCount: candidates.length });
    throw new Error("PHOTO_UPLOAD_FAILED");
  }

  const unreferenced = candidates.filter((path) => !referenced.has(path));
  if (unreferenced.length === 0) return;

  await removeIntakePhotoObjects({
    paths: unreferenced,
    remove: input.remove,
    logFailure: input.logFailure,
    retryAttempts: input.retryAttempts,
    sleep: input.sleep,
  });
}

export async function listReferencedIntakePhotoPaths(
  admin: PhotoAdminClient,
  candidates: string[]
): Promise<string[]> {
  const referenced = new Set<string>();
  const { data: originals, error: originalError } = await admin
    .from("intake_photo")
    .select("storage_path")
    .in("storage_path", candidates);
  if (originalError) throw originalError;
  for (const row of originals ?? []) {
    if (row.storage_path) referenced.add(row.storage_path);
  }
  const { data: thumbs, error: thumbError } = await admin
    .from("intake_photo")
    .select("thumb_storage_path")
    .in("thumb_storage_path", candidates);
  if (thumbError) throw thumbError;
  for (const row of thumbs ?? []) {
    if (row.thumb_storage_path) referenced.add(row.thumb_storage_path);
  }
  return [...referenced];
}

function defaultCleanupLog(details: CleanupFailureDetails): void {
  console.error("intake photo storage cleanup failed", details);
}

export async function cleanupUnreferencedIntakePhotoObjectsAsAdmin(
  paths: string[],
  logFailure: (details: CleanupFailureDetails) => void = defaultCleanupLog
): Promise<void> {
  let admin: PhotoAdminClient;
  try {
    admin = createPhotoAdminClient() as unknown as PhotoAdminClient;
  } catch (error) {
    if (error instanceof Error && error.message === "PHOTO_ADMIN_MISCONFIGURED") {
      throw error;
    }
    throw new Error("PHOTO_ADMIN_MISCONFIGURED");
  }

  await cleanupUnreferencedIntakePhotoObjects({
    paths,
    findReferencedPaths: (candidates) =>
      listReferencedIntakePhotoPaths(admin, candidates),
    remove: async (candidatePaths) =>
      admin.storage.from(INTAKE_PHOTO_BUCKET).remove(candidatePaths),
    logFailure,
  });
}
