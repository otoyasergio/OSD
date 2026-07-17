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
  SERVICE_PRICE_REQUIRED:
    "Enter a price for every selected service before creating the work order.",
  LOCATION_MISMATCH: "Work orders must be created under your active location.",
  TECHNICIAN_NOT_FOUND: "That technician is not available at this location.",
  WORK_ORDER_NOT_FOUND: "That work order no longer exists.",
  WORK_ORDER_NUMBER_FAILED: "Could not mint a work order number. Try again.",
  JOB_NOT_FOUND: "That job no longer exists.",
  FOREIGN_LOCATION:
    "This work order belongs to another location. Switch location to make changes.",
  WORK_ORDER_LOCKED: "This work order is completed or cancelled and cannot be changed.",
  JOB_NOT_READY: "That job is not ready to pull yet.",
  JOB_NOT_ASSIGNED: "Assign a technician before completing this job.",
  JOB_NOT_ASSIGNED_TO_YOU: "You can only start or complete jobs assigned to you.",
  JOB_ALREADY_ASSIGNED: "That job is already assigned.",
  OTHER_JOB_IN_PROGRESS: "Finish or flag your current job before starting another.",
  INVALID_STATUS: "This work order is not in the right status for that action.",
  CHECKLIST_REQUIRED: "Complete the standard work checklist first.",
  CHECKLIST_INCOMPLETE: "Check all checklist items before completing.",
  PARTS_NOT_INSTALLED: "Install or clear all parts before completing.",
  PROOF_REQUIRED: "Add an after photo or a proof exception note.",
  QC_NOT_ASSIGNED_TO_YOU: "This quality check is assigned to another technician.",
  CANNOT_QC_OWN_WORK: "You cannot quality-check work you performed.",
  QC_FAIL_REASON_REQUIRED: "Enter a reason when failing quality check.",
  INVALID_FLAG_REASON: "Choose a valid flag reason.",
  ADMIN_FLAG_NOT_FOUND: "That admin flag no longer exists.",
  ADMIN_FLAG_ALREADY_CLEARED: "That admin flag was already cleared.",
  CHECKLIST_ITEM_NOT_FOUND: "That checklist item no longer exists.",
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
  INSPECTION_NOT_COMPLETED: "Complete the inspection report before finishing jobs.",
  INSPECTION_PHOTOS_REQUIRED:
    "Add required inspection photos (tires, brakes, forks, and any items marked needing work) before completing the report.",
  RECOMMENDATION_NOT_FOUND: "That recommendation no longer exists.",
  RECOMMENDATION_ALREADY_CONVERTED:
    "That recommendation has already been converted to a job.",
  PART_NOT_FOUND: "That part no longer exists.",
  PARTS_ORDER_BEFORE_APPROVAL: "Parts cannot be ordered before customer approval.",
  PART_INSTALL_REQUIRES_TECHNICIAN:
    "Assign a technician to the job before marking parts installed.",
  PARTS_CANADA_NOT_CONFIGURED:
    "Parts Canada is not configured. Add PARTS_CANADA_API_KEY on the server.",
  PARTS_CANADA_SYNC_MISCONFIGURED:
    "Parts Canada sync needs SUPABASE_SERVICE_ROLE_KEY and Supabase URL.",
  PARTS_CANADA_FORBIDDEN:
    "Parts Canada denied access. Check the API key and account mode.",
  PARTS_CANADA_INVENTORY_MISSING: "Parts Canada inventory file is not available yet.",
  PARTS_CANADA_INVENTORY_INVALID:
    "Parts Canada inventory download did not contain a CSV file.",
  PARTS_CANADA_RATE_LIMITED:
    "Parts Canada rate limit hit. Try again later (inventory is limited to a few downloads per day).",
  PARTS_CANADA_SYNC_FAILED: "Parts Canada catalog sync failed.",
  PHOTO_REQUIRED: "Choose a photo to upload.",
  PHOTO_TOO_LARGE: "Photos must be 10 MB or smaller.",
  PHOTO_TYPE_INVALID: "Use a JPEG, PNG, WebP, or HEIC image.",
  PHOTO_UPLOAD_FAILED: "Could not upload the photo. Try again.",
  PHOTO_DELETE_FAILED: "Could not remove the photo. Try again.",
  PHOTO_NOT_FOUND: "That photo no longer exists.",
  INTAKE_PHOTOS_REQUIRED:
    "Add all six required intake photos before creating the work order.",
  INTAKE_PHOTOS_PARTIAL:
    "The work order was created, but some intake photos failed to upload. Finish the missing photos below.",
  NOTE_REQUIRED: "Enter a note before saving.",
  NO_ACTIVE_JOBS: "Add and complete at least one active job before continuing.",
  NO_JOBS_TO_ASSIGN: "This work order has no active jobs to assign. Add a job first.",
  JOBS_NOT_COMPLETE: "All active jobs must be completed first.",
  QC_REQUIRED: "Complete the quality check before marking ready for pickup.",
  SAFETY_FAIL_RECOMMENDATIONS_REQUIRED:
    "Add at least one recommendation when failing safety.",
  NOT_READY_FOR_PICKUP:
    "Mark the work order ready for pickup before completing, or ask an owner/manager to override.",
  HOLD_REASON_REQUIRED: "Enter a reason when placing a work order on hold.",
  NOT_ON_HOLD: "This work order is not on hold.",
  BOARD_MANUAL_STATUS_REQUIRED:
    "Use the work order detail page to place on hold or cancel.",
  INVALID_BOARD_COLUMN: "That board column is not a valid drop target.",
  LOCATION_NOT_FOUND: "That location no longer exists.",
  SHOP_CLOSURE_EXISTS: "That date is already marked as closed.",
  SHOP_CLOSURE_IN_PAST: "Choose today or a future date.",
  SHOP_CLOSURE_NOT_FOUND: "That closure date no longer exists.",
  USER_NOT_FOUND: "That user no longer exists.",
  USER_ALREADY_LINKED: "That auth user is already linked to an app account.",
  VIEW_NAME_REQUIRED: "Enter a name for this view.",
  VIEW_NAME_TOO_LONG: "View names must be 60 characters or fewer.",
  CONTRACT_TEMPLATE_NOT_FOUND: "No active drop-off agreement template is configured.",
  CONTRACT_INITIALS_REQUIRED: "Initial each section before signing.",
  CONTRACT_ALREADY_SIGNED: "A drop-off agreement is already on file for this work order.",
  PAPER_AGREEMENT_REQUIRED:
    "Mark the agreement as signed by paper before uploading its copy.",
  PAPER_COPY_ALREADY_UPLOADED: "A signed paper agreement copy is already on file.",
  SIGNATURE_INVALID: "Could not read the signature image.",
  SIGNATURE_TOO_LARGE: "Signature image is too large.",
  SIGNATURE_UPLOAD_FAILED: "Could not save the signature. Try again.",
  DOCUMENT_TITLE_REQUIRED: "Enter a title for this document.",
  DOCUMENT_REQUIRED: "Choose a file to upload.",
  DOCUMENT_TOO_LARGE: "Documents must be 10 MB or smaller.",
  DOCUMENT_TYPE_INVALID: "Use a PDF, JPEG, PNG, or WebP file.",
  DOCUMENT_UPLOAD_FAILED: "Could not upload the document. Try again.",
  DOCUMENT_NOT_FOUND: "That document no longer exists.",
  SQUARE_NOT_CONFIGURED:
    "Square is not configured. Add SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID.",
  SQUARE_INVOICE_NOT_READY:
    "Sync a draft and get approvals before publishing the Square invoice.",
  SQUARE_NO_BILLABLE_LINES: "No priced jobs or parts to put on the estimate/invoice.",
  SQUARE_INVOICE_ALREADY_PUBLISHED:
    "A Square invoice is already published. Cancel & recreate, or publish the balance after a deposit.",
  SQUARE_ALREADY_PAID: "This work order is already fully paid.",
  SQUARE_CANCEL_NOT_ALLOWED:
    "Cannot cancel a partially paid or paid invoice. Handle the remainder in Square or publish balance.",
  SQUARE_BALANCE_NOT_READY: "Collect a deposit payment before publishing the balance.",
  TWILIO_NOT_CONFIGURED: "Twilio is not configured for SMS.",
  SMS_OPTED_OUT: "This customer has opted out of SMS. Use email or clear the opt-out.",
  INVALID_PHONE: "Customer phone number is not a valid mobile number.",
  EMAIL_NOT_CONFIGURED: "Email is not configured. Add RESEND_API_KEY.",
  CUSTOMER_PHONE_REQUIRED: "Customer needs a phone number to send SMS.",
  CUSTOMER_EMAIL_REQUIRED: "Customer needs an email address to send email.",
  MESSAGE_TEMPLATE_NOT_FOUND: "That message template does not exist.",
  PORTAL_TOKEN_INVALID: "This link is invalid or has been revoked.",
  PORTAL_TOKEN_EXPIRED: "This link has expired. Ask the shop for a new one.",
  CREDIT_AMOUNT_INVALID: "Credit amount must be greater than zero.",
  BOOKING_MOTORCYCLE_REQUIRED:
    "Could not match a motorcycle for this booking. Link the customer bike first.",
  WIX_NOT_CONFIGURED:
    "Wix is not configured. Add WIX_API_KEY and WIX_SITE_ID on the server.",
  WIX_WEBHOOK_NOT_CONFIGURED: "Wix webhook secret is not configured.",
  WIX_SYNC_MISCONFIGURED: "Wix sync needs SUPABASE_SERVICE_ROLE_KEY and Supabase URL.",
  WIX_CONTACT_NOT_FOUND: "That Wix contact no longer exists.",
  WIX_CONTACT_NOT_LINKED:
    "This customer is not linked to a Wix contact yet. Sync to Wix first.",
  WIX_CONTACT_SYNC_FAILED: "Could not sync this customer to Wix.",
  WIX_WEBHOOK_INVALID: "Wix webhook payload is missing a contact id.",
  WIX_WEBHOOK_CONTACT_REQUIRED: "Wix webhook contact needs an email or phone number.",
  FITMENT_IMPORT_FAILED: "Fitment import failed.",
  ALREADY_CLOCKED_IN: "That person already has an open punch. Clock them out first.",
  NOT_CLOCKED_IN: "Not clocked in.",
  ALREADY_ON_BREAK: "You are already on a break.",
  NOT_ON_BREAK: "You are not on a break.",
  TIMESHEET_WEEK_LOCKED:
    "That timesheet week is approved. Reopen it before editing punches.",
  INVALID_WEEK: "Choose a valid week.",
  NOT_CLOCKED_IN_FOR_JOB: "Clock in for your shift before starting job time.",
  JOB_TIME_ALREADY_OPEN: "Pause or finish your current job timer first.",
  JOB_TIME_NOT_OPEN: "No open job timer to pause.",
  JOB_TIME_WRONG_JOB: "That job timer is not yours or already closed.",
  OPENED_AT_UNAVAILABLE:
    "Open timer is not available until the database migration is applied.",
  INVALID_CLOCK_IN: "Enter a valid clock-in date and time.",
  INVALID_CLOCK_OUT: "Enter a valid clock-out date and time.",
  CLOCK_OUT_BEFORE_IN: "Clock-out must be after clock-in.",
  CORRECTION_REQUIRES_CLOCK_OUT: "Missed punches need both clock-in and clock-out times.",
  TIME_CLOCK_ENTRY_NOT_FOUND: "That time clock entry no longer exists.",
  INVALID_BREAK_START: "Enter a valid break start date and time.",
  INVALID_BREAK_END: "Enter a valid break end date and time.",
  BREAK_END_BEFORE_START: "Break end must be after break start.",
  BREAK_OUTSIDE_PUNCH: "Break must fall within the punch clock-in and clock-out.",
  BREAK_NOT_FOUND: "That break slot no longer exists.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  INVALID_INITIALS: "Could not read initials. Refresh and try again.",
  CONVERSATION_NOT_FOUND: "That conversation no longer exists.",
  NOT_A_PARTICIPANT: "You're not part of this conversation.",
  SELF_DM_NOT_ALLOWED: "You can't start a conversation with yourself.",
  RECIPIENT_REQUIRED: "Choose at least one person to message.",
  MESSAGE_NOT_FOUND: "That message no longer exists.",
  NOT_MESSAGE_SENDER: "You can only change your own messages.",
  UNSEND_WINDOW_EXPIRED: "This message is too old to unsend.",
  ATTACHMENT_TOO_LARGE: "Attachments must be 25 MB or smaller.",
  ATTACHMENT_TYPE_INVALID: "That file type isn't supported in Messages.",
  ATTACHMENT_UPLOAD_FAILED: "Could not upload the attachment. Try again.",
  TWILIO_VIDEO_NOT_CONFIGURED:
    "Video calling is not configured. Add TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET.",
  CALL_NOT_FOUND: "That call no longer exists.",
  CALL_ALREADY_ENDED: "That call has already ended.",
  PROFILE_PHOTO_REQUIRED: "Choose a profile photo to upload.",
  PROFILE_PHOTO_TOO_LARGE: "Profile photos must be 5 MB or smaller.",
  PROFILE_PHOTO_TYPE_INVALID: "Use a JPEG, PNG, or WebP profile photo.",
  PROFILE_PHOTO_UPLOAD_FAILED: "Could not upload your profile photo. Try again.",
  PROFILE_PHOTO_UPDATE_FAILED: "Could not update your profile photo. Try again.",
  CURRENT_PASSWORD_REQUIRED: "Enter your current password.",
  CURRENT_PASSWORD_INVALID: "Current password is incorrect.",
  NEW_PASSWORD_REQUIRED: "Enter a new password.",
  NEW_PASSWORD_TOO_SHORT: "New password must be at least 8 characters.",
  PASSWORD_CONFIRM_MISMATCH: "New password and confirmation do not match.",
  PASSWORD_UNCHANGED: "Choose a new password that is different from your current one.",
  PASSWORD_UPDATE_FAILED: "Could not update your password. Try again.",
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
