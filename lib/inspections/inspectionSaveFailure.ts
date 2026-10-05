export const INSPECTION_SAVE_STALE_PAGE_MESSAGE =
  "This page is out of date, so that was not saved. Reload the page, then enter it again. What you typed is still on this screen.";

export const INSPECTION_SAVE_CONNECTION_MESSAGE =
  "The connection dropped, so that was not saved. Try again. What you typed is still on this screen.";

export const INSPECTION_SAVE_FAILED_MESSAGE =
  "That was not saved. Try again. What you typed is still on this screen.";

/**
 * A thrown Server Action (missing action after a deploy, or a dropped
 * connection) never returns `{ ok: false }`. The row must keep the local
 * draft and tell the tech the write did not land.
 */
export function describeInspectionSaveFailure(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (
    /server action .* was not found on the server|failed-to-find-server-action/i.test(
      message
    )
  ) {
    return INSPECTION_SAVE_STALE_PAGE_MESSAGE;
  }
  const name = error instanceof Error ? error.name : "";
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    name === "NetworkError" ||
    /failed to fetch|load failed|network request failed|network connection|connection was lost|offline|timed? ?out/i.test(
      message
    )
  ) {
    return INSPECTION_SAVE_CONNECTION_MESSAGE;
  }
  return INSPECTION_SAVE_FAILED_MESSAGE;
}
