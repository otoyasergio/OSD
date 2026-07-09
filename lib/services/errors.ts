import { ZodError } from "zod";

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NO_LOCATION: "Ask an owner to assign you a location before continuing.",
  CUSTOMER_NOT_FOUND: "That customer no longer exists.",
  MOTORCYCLE_NOT_FOUND: "That motorcycle no longer exists.",
  SERVICE_NOT_FOUND: "That service no longer exists.",
  LOCATION_MISMATCH: "Work orders must be created under your active location.",
  TECHNICIAN_NOT_FOUND: "That technician is not available at this location.",
  WORK_ORDER_NOT_FOUND: "That work order no longer exists.",
  WORK_ORDER_NUMBER_FAILED: "Could not mint a work order number. Try again.",
  JOB_NOT_FOUND: "That job no longer exists.",
  FOREIGN_LOCATION:
    "This work order belongs to another location. Switch location to make changes.",
  WORK_ORDER_LOCKED: "This work order is completed or cancelled and cannot be changed.",
  JOB_NOT_READY: "That job is not ready to start yet.",
  JOB_NOT_ASSIGNED: "Assign a technician before completing this job.",
  JOB_NOT_ASSIGNED_TO_YOU: "You can only start or complete jobs assigned to you.",
  JOB_NOT_AWAITING_APPROVAL: "That job is not waiting for customer approval.",
  JOB_CANNOT_DECLINE: "That job cannot be declined in its current status.",
  DECLINE_REASON_REQUIRED: "A decline reason is required.",
  CANCEL_NOTE_REQUIRED: "A cancel note is required.",
  TEMPLATE_ITEM_NOT_FOUND: "That inspection template item no longer exists.",
  INSPECTION_NOT_FOUND: "That inspection no longer exists.",
  INSPECTION_RESULT_NOT_FOUND: "That inspection result no longer exists.",
  INSPECTION_ALREADY_COMPLETE: "This inspection is already complete.",
  INSPECTION_INCOMPLETE:
    "Some checklist items are still incomplete. An owner or manager can force completion.",
  RECOMMENDATION_NOT_FOUND: "That recommendation no longer exists.",
  RECOMMENDATION_ALREADY_CONVERTED:
    "That recommendation has already been converted to a job.",
  PART_NOT_FOUND: "That part no longer exists.",
  PARTS_ORDER_BEFORE_APPROVAL:
    "Parts cannot be ordered before customer approval.",
  PART_INSTALL_REQUIRES_TECHNICIAN:
    "Assign a technician to the job before marking parts installed.",
};

export function toFormErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Please check the details and try again.";
  }

  if (error instanceof Error) {
    return MESSAGES[error.message] ?? error.message;
  }

  return "Something went wrong. Please try again.";
}
