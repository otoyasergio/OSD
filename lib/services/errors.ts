import { ZodError } from "zod";

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NO_LOCATION: "Ask an owner to assign you a location before continuing.",
  CUSTOMER_NOT_FOUND: "That customer no longer exists.",
  SAME_CUSTOMER: "Choose a different customer to transfer this motorcycle to.",
  VIN_ALREADY_EXISTS:
    "That VIN is already on another motorcycle. Transfer it or use a different VIN.",
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
  PARTS_CANADA_NOT_CONFIGURED:
    "Parts Canada is not configured. Add PARTS_CANADA_API_KEY on the server.",
  PARTS_CANADA_SYNC_MISCONFIGURED:
    "Parts Canada sync needs SUPABASE_SERVICE_ROLE_KEY and Supabase URL.",
  PARTS_CANADA_FORBIDDEN:
    "Parts Canada denied access. Check the API key and account mode.",
  PARTS_CANADA_INVENTORY_MISSING:
    "Parts Canada inventory file is not available yet.",
  PARTS_CANADA_INVENTORY_INVALID:
    "Parts Canada inventory download did not contain a CSV file.",
  PARTS_CANADA_RATE_LIMITED:
    "Parts Canada rate limit hit. Try again later (inventory is limited to a few downloads per day).",
  PARTS_CANADA_SYNC_FAILED: "Parts Canada catalog sync failed.",
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
  CONTRACT_TEMPLATE_NOT_FOUND: "No active drop-off agreement template is configured.",
  CONTRACT_INITIALS_REQUIRED: "Initial each section before signing.",
  CONTRACT_ALREADY_SIGNED: "A drop-off agreement is already on file for this work order.",
  SIGNATURE_INVALID: "Could not read the signature image.",
  SIGNATURE_TOO_LARGE: "Signature image is too large.",
  SIGNATURE_UPLOAD_FAILED: "Could not save the signature. Try again.",
  SQUARE_NOT_CONFIGURED: "Square is not configured. Add SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID.",
  SQUARE_INVOICE_NOT_READY: "Mark the work order ready for pickup before creating a Square invoice.",
  SQUARE_NO_BILLABLE_LINES: "No approved jobs or priced parts to invoice.",
  TWILIO_NOT_CONFIGURED: "Twilio is not configured for SMS.",
  EMAIL_NOT_CONFIGURED: "Email is not configured. Add RESEND_API_KEY.",
  CUSTOMER_PHONE_REQUIRED: "Customer needs a phone number to send SMS.",
  CUSTOMER_EMAIL_REQUIRED: "Customer needs an email address to send email.",
  MESSAGE_TEMPLATE_NOT_FOUND: "That message template does not exist.",
  PORTAL_TOKEN_INVALID: "This link is invalid or has been revoked.",
  PORTAL_TOKEN_EXPIRED: "This link has expired. Ask the shop for a new one.",
  CREDIT_AMOUNT_INVALID: "Credit amount must be greater than zero.",
  BOOKING_MOTORCYCLE_REQUIRED: "Could not match a motorcycle for this booking. Link the customer bike first.",
  WIX_NOT_CONFIGURED: "Wix is not configured.",
  FITMENT_IMPORT_FAILED: "Fitment import failed.",
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
