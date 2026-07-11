import { ZodError } from "zod";

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NO_LOCATION: "Ask an owner to assign you a location before continuing.",
  CUSTOMER_NOT_FOUND: "That customer no longer exists.",
  SAME_CUSTOMER: "Choose a different customer to transfer this motorcycle to.",
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
  INSPECTION_NOT_COMPLETED:
    "Complete the inspection report before finishing jobs.",
  INSPECTION_PHOTOS_REQUIRED:
    "Add required inspection photos (tires, brakes, forks, and any items marked needing work) before completing the report.",
  RECOMMENDATION_NOT_FOUND: "That recommendation no longer exists.",
  RECOMMENDATION_ALREADY_CONVERTED:
    "That recommendation has already been converted to a job.",
  PART_NOT_FOUND: "That part no longer exists.",
  PARTS_ORDER_BEFORE_APPROVAL:
    "Parts cannot be ordered before customer approval.",
  PART_INSTALL_REQUIRES_TECHNICIAN:
    "Assign a technician to the job before marking parts installed.",
  PHOTO_REQUIRED: "Choose a photo to upload.",
  PHOTO_TOO_LARGE: "Photos must be 10 MB or smaller.",
  PHOTO_TYPE_INVALID: "Use a JPEG, PNG, WebP, or HEIC image.",
  PHOTO_UPLOAD_FAILED: "Could not upload the photo. Try again.",
  PHOTO_NOT_FOUND: "That photo no longer exists.",
  INTAKE_PHOTOS_REQUIRED:
    "Add all six required intake photos before creating the work order.",
  INTAKE_PHOTOS_PARTIAL:
    "The work order was created, but some intake photos failed to upload. Finish the missing photos below.",
  NOTE_REQUIRED: "Enter a note before saving.",
  NO_ACTIVE_JOBS: "Add and complete at least one active job before continuing.",
  JOBS_NOT_COMPLETE: "All active jobs must be completed first.",
  QC_REQUIRED: "Complete the quality check before marking ready for pickup.",
  NOT_READY_FOR_PICKUP:
    "Mark the work order ready for pickup before completing, or ask an owner/manager to override.",
  HOLD_REASON_REQUIRED: "Enter a reason when placing a work order on hold.",
  NOT_ON_HOLD: "This work order is not on hold.",
  BOARD_MANUAL_STATUS_REQUIRED:
    "Use the work order detail page to place on hold or cancel.",
  INVALID_BOARD_COLUMN: "That board column is not a valid drop target.",
  LOCATION_NOT_FOUND: "That location no longer exists.",
  USER_NOT_FOUND: "That user no longer exists.",
  USER_ALREADY_LINKED: "That auth user is already linked to an app account.",
  VIEW_NAME_REQUIRED: "Enter a name for this view.",
  VIEW_NAME_TOO_LONG: "View names must be 60 characters or fewer.",
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
