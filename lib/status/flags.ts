import type { WorkOrderStatus } from "@/lib/database/types";

export type WorkOrderFlagInput = {
  status: WorkOrderStatus;
  vin?: string | null;
  estimated_completion?: string | null;
  jobs: Array<{ status: string; assigned_technician_id?: string | null }>;
  recommendations: Array<{ severity: string; status: string }>;
  photoCount: number;
  inspectionComplete?: boolean | null;
  /** When false, emit Contract unsigned (skip completed/cancelled). Omit to leave unchecked. */
  hasSignedAgreement?: boolean | null;
  now?: Date;
};

const TERMINAL: WorkOrderStatus[] = ["completed", "cancelled"];

export function isOverdue(
  estimatedCompletion: string | null | undefined,
  status: WorkOrderStatus,
  now: Date = new Date()
): boolean {
  if (!estimatedCompletion) return false;
  if (TERMINAL.includes(status)) return false;
  return new Date(estimatedCompletion).getTime() < now.getTime();
}

export function buildWorkOrderFlags(input: WorkOrderFlagInput): string[] {
  const now = input.now ?? new Date();
  const flags: string[] = [];

  if (!input.vin?.trim()) flags.push("Missing VIN");
  if (input.photoCount === 0) flags.push("No intake photos");
  if (
    input.hasSignedAgreement === false &&
    !TERMINAL.includes(input.status)
  ) {
    flags.push("Contract unsigned");
  }
  if (input.inspectionComplete === false) {
    flags.push("Incomplete inspection");
  }
  if (input.jobs.some((job) => job.status === "waiting_for_approval")) {
    flags.push("Needs approval");
  }
  if (
    input.status === "waiting_for_parts" ||
    input.jobs.some((job) => job.status === "waiting_for_parts")
  ) {
    flags.push("Waiting for parts");
  }
  if (
    input.recommendations.some(
      (rec) => rec.status === "pending" && rec.severity === "safety_critical"
    )
  ) {
    flags.push("Safety-critical");
  }
  if (isOverdue(input.estimated_completion, input.status, now)) {
    flags.push("Overdue");
  }
  if (input.status === "on_hold") flags.push("On hold");

  return flags;
}
