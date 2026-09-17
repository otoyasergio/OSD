import type { JobStatus } from "@/lib/database/types";

export type JobOrigin = "customer_request" | "recommendation" | "shop_added";

export const JOB_ORIGIN_LABELS: Record<JobOrigin, string> = {
  customer_request: "Customer asked",
  recommendation: "Recommended",
  shop_added: "Shop added",
};

/** Authorization chip — customer said yes/no/waiting. */
export type JobAuthorizationLabel =
  "Approved" | "Waiting approval" | "Declined" | "Draft";

/** Work progress chip — what the tech is doing (never "Approved"). */
export type JobWorkLabel =
  "Not started" | "Waiting on parts" | "In progress" | "Done" | "Cancelled" | "—";

const AUTHORIZED_WORK_STATUSES: ReadonlySet<JobStatus> = new Set([
  "approved",
  "ready_to_start",
  "in_progress",
  "waiting_for_parts",
  "completed",
]);

const WAITING_STATUSES: ReadonlySet<JobStatus> = new Set([
  "draft",
  "waiting_for_approval",
]);

export type VisitWorkListJob = {
  job_id: string;
  service_name_snapshot: string;
  status: JobStatus;
  origin: JobOrigin | null;
  notes: string | null;
};

export type VisitWorkListRecommendation = {
  recommendation_id?: string;
  description: string;
  severity?: string;
  status: string;
  converted_job_id?: string | null;
};

export type VisitWorkListItem = {
  key: string;
  title: string;
  notes: string | null;
  origin: JobOrigin | null;
  authorization: JobAuthorizationLabel | null;
  work: JobWorkLabel | null;
  job_id?: string;
  severity?: string;
};

export type VisitWorkList = {
  customerAsked: VisitWorkListItem[];
  recommended: VisitWorkListItem[];
  techDoesThis: VisitWorkListItem[];
  notDoing: VisitWorkListItem[];
};

export function normalizeJobOrigin(value: string | null | undefined): JobOrigin {
  if (
    value === "customer_request" ||
    value === "recommendation" ||
    value === "shop_added"
  ) {
    return value;
  }
  return "shop_added";
}

export function jobAuthorizationLabel(status: JobStatus): JobAuthorizationLabel | null {
  if (status === "declined") return "Declined";
  if (status === "draft") return "Draft";
  if (status === "waiting_for_approval") return "Waiting approval";
  if (
    status === "approved" ||
    status === "ready_to_start" ||
    status === "in_progress" ||
    status === "waiting_for_parts" ||
    status === "completed"
  ) {
    return "Approved";
  }
  if (status === "cancelled") return null;
  return null;
}

export function jobWorkLabel(status: JobStatus): JobWorkLabel {
  if (status === "completed") return "Done";
  if (status === "in_progress") return "In progress";
  if (status === "waiting_for_parts") return "Waiting on parts";
  if (status === "approved" || status === "ready_to_start") return "Not started";
  if (status === "cancelled") return "Cancelled";
  return "—";
}

function jobToItem(job: VisitWorkListJob): VisitWorkListItem {
  return {
    key: `job:${job.job_id}`,
    title: job.service_name_snapshot,
    notes: job.notes?.trim() || null,
    origin: job.origin ? normalizeJobOrigin(job.origin) : null,
    authorization: jobAuthorizationLabel(job.status),
    work: jobWorkLabel(job.status),
    job_id: job.job_id,
  };
}

/**
 * Buckets a visit into the shop story: asked → recommended → tech does this → not doing.
 */
export function buildVisitWorkList(input: {
  jobs: VisitWorkListJob[];
  openRecommendations?: VisitWorkListRecommendation[];
}): VisitWorkList {
  const customerAsked: VisitWorkListItem[] = [];
  const recommended: VisitWorkListItem[] = [];
  const techDoesThis: VisitWorkListItem[] = [];
  const notDoing: VisitWorkListItem[] = [];

  for (const job of input.jobs) {
    const origin = normalizeJobOrigin(job.origin);
    const item = jobToItem({ ...job, origin });

    if (job.status === "declined" || job.status === "cancelled") {
      notDoing.push(item);
      continue;
    }

    if (origin === "customer_request") {
      customerAsked.push(item);
    } else if (origin === "recommendation" && WAITING_STATUSES.has(job.status)) {
      recommended.push(item);
    } else if (origin === "shop_added" && WAITING_STATUSES.has(job.status)) {
      recommended.push(item);
    }

    if (AUTHORIZED_WORK_STATUSES.has(job.status)) {
      techDoesThis.push(item);
    }
  }

  for (const rec of input.openRecommendations ?? []) {
    if (rec.converted_job_id) continue;
    if (rec.status === "declined" || rec.status === "deferred") {
      notDoing.push({
        key: `rec:${rec.recommendation_id ?? rec.description}`,
        title: rec.description,
        notes: null,
        origin: "recommendation",
        authorization: rec.status === "declined" ? "Declined" : null,
        work: "—",
        severity: rec.severity,
      });
      continue;
    }
    if (rec.status === "pending" || rec.status === "approved") {
      recommended.push({
        key: `rec:${rec.recommendation_id ?? rec.description}`,
        title: rec.description,
        notes: null,
        origin: "recommendation",
        authorization: "Waiting approval",
        work: "—",
        severity: rec.severity,
      });
    }
  }

  return { customerAsked, recommended, techDoesThis, notDoing };
}

/** Jobs the tech should perform — authorized work only. */
export function isTechDoesThisStatus(status: JobStatus): boolean {
  return AUTHORIZED_WORK_STATUSES.has(status);
}
