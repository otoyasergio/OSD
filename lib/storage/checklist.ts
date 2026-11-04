export const UNFINISHED_APPROVED_JOB_STATUSES = [
  "approved",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
] as const;

const OUTSTANDING_PART_STATUSES = new Set(["needed", "ordered"]);
const IGNORED_JOB_STATUSES = new Set(["declined", "cancelled"]);

export type StorageChecklistJob = {
  jobId: string;
  name: string;
  status: string;
};

export type StorageChecklistPart = {
  name: string;
  status: string;
  jobId: string | null;
};

export type StorageChecklistLine = {
  id: string;
  name: string;
  detail?: string;
};

export type StorageChecklist = {
  inspectionDone: boolean;
  awaitingApproval: StorageChecklistLine[];
  unfinishedApproved: StorageChecklistLine[];
  partsOutstanding: StorageChecklistLine[];
  phoneMissing: boolean;
  /** Arrival inspection done, estimate decided, and approved work finished. */
  canStore: boolean;
};

export function buildStorageChecklist(input: {
  inspectionComplete: boolean;
  jobs: readonly StorageChecklistJob[];
  parts: readonly StorageChecklistPart[];
  phone: string | null;
}): StorageChecklist {
  const ignoredJobIds = new Set(
    input.jobs.filter((job) => IGNORED_JOB_STATUSES.has(job.status)).map((job) => job.jobId)
  );
  const awaitingApproval = input.jobs
    .filter((job) => job.status === "waiting_for_approval")
    .map((job) => ({ id: job.jobId, name: job.name || "Recommended work" }));
  const unfinishedApproved = input.jobs
    .filter((job) =>
      (UNFINISHED_APPROVED_JOB_STATUSES as readonly string[]).includes(job.status)
    )
    .map((job) => ({
      id: job.jobId,
      name: job.name || "Approved work",
      detail: job.status.replaceAll("_", " "),
    }));
  const partsOutstanding = input.parts
    .filter(
      (part) =>
        OUTSTANDING_PART_STATUSES.has(part.status) &&
        (part.jobId == null || !ignoredJobIds.has(part.jobId))
    )
    .map((part, index) => ({
      id: `${part.jobId ?? "part"}-${index}`,
      name: part.name || "Part",
      detail: part.status,
    }));
  const inspectionDone = input.inspectionComplete;
  const canStore =
    inspectionDone &&
    awaitingApproval.length === 0 &&
    unfinishedApproved.length === 0 &&
    partsOutstanding.length === 0;

  return {
    inspectionDone,
    awaitingApproval,
    unfinishedApproved,
    partsOutstanding,
    phoneMissing: !input.phone?.trim(),
    canStore,
  };
}

export type StorageLeaveBlockCode =
  | "INSPECTION_REQUIRED_BEFORE_PICKUP"
  | "STORAGE_ESTIMATE_OPEN"
  | "STORAGE_WORK_INCOMPLETE";

/** Why a bike cannot enter storage. Owner and admin skips do not apply. */
export function storageLeaveBlockCode(
  checklist: Pick<
    StorageChecklist,
    "inspectionDone" | "awaitingApproval" | "unfinishedApproved" | "partsOutstanding"
  >
): StorageLeaveBlockCode | null {
  if (!checklist.inspectionDone) return "INSPECTION_REQUIRED_BEFORE_PICKUP";
  if (checklist.awaitingApproval.length > 0) return "STORAGE_ESTIMATE_OPEN";
  if (checklist.unfinishedApproved.length > 0 || checklist.partsOutstanding.length > 0) {
    return "STORAGE_WORK_INCOMPLETE";
  }
  return null;
}
