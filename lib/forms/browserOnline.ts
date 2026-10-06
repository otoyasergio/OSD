/**
 * Playwright WebKit (and some real Safari drops) can fire `offline` while
 * leaving `navigator.onLine === true`. Photo enqueue and compression must
 * treat that event as authoritative or they wait on a worker chunk that
 * cannot load.
 */

let offlineFromEvent: boolean | null = null;
let bound = false;

function bindOfflineEvents() {
  if (bound || typeof window === "undefined") return;
  bound = true;
  window.addEventListener("offline", () => {
    offlineFromEvent = true;
  });
  window.addEventListener("online", () => {
    offlineFromEvent = false;
  });
}

export function isBrowserOffline(): boolean {
  bindOfflineEvents();
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return offlineFromEvent === true;
}

export function isBrowserOnline(): boolean {
  return !isBrowserOffline();
}

/** Vitest only — clears the window-event latch. */
export function resetBrowserOnlineForTests() {
  offlineFromEvent = null;
  bound = false;
}
