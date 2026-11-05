export const STAFF_FEEDBACK_BUCKET = "staff-feedback";
export const STAFF_FEEDBACK_NOTE_MAX = 2000;
export const STAFF_FEEDBACK_PAGE_MAX = 300;
export const STAFF_FEEDBACK_HOURLY_LIMIT = 8;
export const STAFF_FEEDBACK_SQUASH_BATCH = 50;
export const STAFF_FEEDBACK_SUMMARY_MAX = 12000;
export const STAFF_FEEDBACK_SCREENSHOT_MAX_EDGE = 1440;
export const STAFF_FEEDBACK_SCREENSHOT_MAX_BYTES = 500_000;
export const STAFF_FEEDBACK_SCREENSHOT_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
/** Matches the private bucket limit. One night's zip has to fit in one object. */
export const STAFF_FEEDBACK_ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;
