import type { WorkOrderStatus } from "@/lib/database/types";
import { isSafetyRequired } from "@/lib/status/safetyRequired";

export type WorkOrderNextAction = {
  title: string;
  detail: string;
  href?: string;
  cta?: string;
};

type NextActionInput = {
  workOrderId: string;
  status: WorkOrderStatus;
  qualityChecked: boolean;
  safetyChecked: boolean;
  readyForPickup: boolean;
  safety_required: boolean | null;
  safety_waived: boolean;
  jobs: Array<{ status: string; service_name_snapshot: string }>;
  hasAssignedTech: boolean;
  inspectionCompleted: boolean;
};

/**
 * Single “what to do next” callout for the front-office Overview tab.
 */
export function getWorkOrderNextAction(
  input: NextActionInput
): WorkOrderNextAction | null {
  if (input.status === "completed") {
    return {
      title: "Completed",
      detail: "This work order is filed. Open Complete archive if you need the record.",
    };
  }
  if (input.status === "cancelled") {
    return {
      title: "Cancelled",
      detail: "No further shop actions on this visit.",
    };
  }
  if (input.status === "on_hold") {
    return {
      title: "On hold",
      detail: "Resume from Overview when the hold reason is cleared.",
    };
  }

  if (!input.hasAssignedTech) {
    return {
      title: "Assign a technician",
      detail: "Put this bike on a tech’s docket so work can start.",
    };
  }

  if (!input.inspectionCompleted) {
    return {
      title: "Complete the inspection",
      detail: "Visual inspection must be finished before jobs can be marked done.",
      href: `/work_orders/${input.workOrderId}/inspection`,
      cta: "Open inspection",
    };
  }

  const activeIncomplete = input.jobs.some(
    (job) =>
      job.status !== "completed" &&
      job.status !== "cancelled" &&
      job.status !== "declined"
  );
  if (activeIncomplete) {
    return {
      title: "Finish active jobs",
      detail: "Technicians complete jobs on the floor; track progress on the Jobs tab.",
      href: `/work_orders/${input.workOrderId}?tab=jobs`,
      cta: "View jobs",
    };
  }

  if (!input.qualityChecked) {
    return {
      title: "Run quality check",
      detail: "All active jobs are done — QC is the next gate.",
    };
  }

  const safetyNeeded = isSafetyRequired({
    safety_required: input.safety_required,
    safety_waived: input.safety_waived,
    jobs: input.jobs,
  });
  if (safetyNeeded && !input.safetyChecked) {
    return {
      title: "Safety check",
      detail: "Waiting on head-tech safety before ready for pickup.",
    };
  }

  if (!input.readyForPickup && input.status !== "ready_for_pickup") {
    return {
      title: "Mark ready for pickup",
      detail: "QC is done — mark the bike ready when the customer can collect.",
    };
  }

  if (input.status === "ready_for_pickup" || input.readyForPickup) {
    return {
      title: "Complete / release",
      detail: "Customer pickup — complete the work order when they leave with the bike.",
    };
  }

  return {
    title: "In progress",
    detail: "Continue shop workflow from the sections below.",
  };
}
