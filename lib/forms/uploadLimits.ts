/**
 * Vercel Functions reject any request body over 4.5 MB with a 413
 * (`FUNCTION_PAYLOAD_TOO_LARGE`) at the edge, before Next.js or Supabase see
 * it. Server Actions are functions, so `serverActions.bodySizeLimit` cannot
 * raise this — the app never gets to log the failure and the browser only sees
 * an "unexpected response".
 *
 * See https://vercel.com/docs/functions/limitations
 */
export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4_500_000;

/**
 * Largest single file the client will hand to a Server Action. Leaves room for
 * multipart boundaries, text fields, and the action envelope under the cap.
 */
export const SERVER_ACTION_UPLOAD_MAX_BYTES = 4_000_000;

export function exceedsServerActionUploadLimit(file: { size: number }): boolean {
  return file.size > SERVER_ACTION_UPLOAD_MAX_BYTES;
}

/** "3.5 MB" / "12 MB" — decimal megabytes, matching how the limits above are stated. */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `${rounded} MB`;
}
