import { ZodError } from "zod";

export type FieldErrors = Record<string, string>;

export type ActionResult = {
  error: string | null;
  fieldErrors?: FieldErrors;
};

/**
 * Map Zod issues to a flat field → message map (first error per path).
 */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    if (!fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

export function actionErrorFromUnknown(error: unknown): ActionResult {
  if (error instanceof ZodError) {
    return {
      error: error.issues[0]?.message ?? "Please check the details and try again.",
      fieldErrors: zodFieldErrors(error),
    };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: "Something went wrong. Please try again." };
}
