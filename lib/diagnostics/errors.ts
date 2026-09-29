const DIAGNOSTICS_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  DIAGNOSTICS_CONTEXT_TOO_LARGE:
    "Ask OTOMOTO could not safely fit this work-order context.",
  DIAGNOSTICS_CONTEXT_WORK_ORDER_MISMATCH:
    "Ask OTOMOTO context did not match this work order.",
  DIAGNOSTICS_CONTEXT_JOB_MISMATCH: "Ask OTOMOTO context did not match the selected job.",
  DIAGNOSTICS_CONTEXT_TIME_INVALID:
    "Ask OTOMOTO context did not include a valid server timestamp.",
  DIAGNOSTICS_IMAGE_WORK_ORDER_INVALID:
    "Ask OTOMOTO needs a valid work order before selecting photos.",
  DIAGNOSTICS_IMAGE_ID_INVALID: "A selected photo identifier is invalid.",
  DIAGNOSTICS_IMAGE_PURPOSE_INVALID:
    "Describe why each selected photo is relevant in 500 characters or fewer.",
  DIAGNOSTICS_IMAGE_ROW_DUPLICATE: "A selected photo was returned more than once.",
  DIAGNOSTICS_IMAGE_NOT_SELECTED:
    "Ask OTOMOTO received a photo that was not explicitly selected.",
  DIAGNOSTICS_IMAGE_STORAGE_PATH_INVALID:
    "A selected photo has no valid private storage object.",
  DIAGNOSTICS_AI_CONTEXT_AUDIENCE_MISMATCH:
    "Ask OTOMOTO context did not match the selected mode.",
  DIAGNOSTICS_AI_IMAGE_INVALID:
    "Ask OTOMOTO accepts only a prepared private JPEG data image.",
  DIAGNOSTICS_AI_TOO_MANY_IMAGES:
    "Attach no more than three photos to one Ask OTOMOTO turn.",
  DIAGNOSTICS_IMAGE_JOB_REQUIRED:
    "Select the matching job before attaching a job work or proof photo.",
  DIAGNOSTICS_IMAGE_JOB_MISMATCH: "That photo does not belong to the selected job.",
  DIAGNOSTICS_IMAGE_WORK_ORDER_MISMATCH: "That photo does not belong to this work order.",
  DIAGNOSTICS_IMAGE_NOT_FOUND: "A selected photo is no longer available.",
  DIAGNOSTICS_IMAGE_DUPLICATE: "Select each photo only once.",
  DIAGNOSTICS_IMAGE_SELECTION_LIMIT:
    "Attach no more than three photos to one Ask OTOMOTO turn.",
  DIAGNOSTICS_IMAGE_CATEGORY_NOT_ALLOWED:
    "Only authorized inspection, job-work, and job-proof photos can be analyzed.",
  DIAGNOSTICS_IMAGE_FORMAT_UNSUPPORTED: "Use a JPEG, PNG, WebP, HEIC, or HEIF image.",
  DIAGNOSTICS_IMAGE_PIXEL_LIMIT: "The selected image must not exceed 50 megapixels.",
  DIAGNOSTICS_IMAGE_TOO_LARGE: "The selected image must be 10 MB or smaller.",
  DIAGNOSTICS_IMAGE_DECODE_FAILED: "Ask OTOMOTO could not read the selected image.",
  DIAGNOSTICS_IMAGE_NORMALIZATION_FAILED:
    "Ask OTOMOTO could not safely normalize the selected image.",
  DIAGNOSTICS_AI_RESPONSE_SCHEMA_INVALID:
    "Ask OTOMOTO returned an invalid structured draft. Try again.",
  DIAGNOSTICS_AI_RESPONSE_PARSE_FAILED:
    "Ask OTOMOTO could not parse the provider response safely.",
  DIAGNOSTICS_AI_RESPONSE_REFUSED:
    "Ask OTOMOTO refused this request. Continue manually or revise the request.",
  DIAGNOSTICS_AI_RESPONSE_MODEL_MISSING:
    "Ask OTOMOTO did not report the model used for this draft.",
};

export function diagnosticsErrorMessage(code: string): string {
  return DIAGNOSTICS_ERROR_MESSAGES[code] ?? "Ask OTOMOTO could not create a safe draft.";
}
