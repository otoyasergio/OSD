/**
 * A checklist line's version is its `updated_at`. The same instant can arrive
 * written two ways ("Z" or "+00:00"), so versions are compared as times, not
 * as text.
 */
export function isSameInstant(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) || Number.isNaN(right)) return a === b;
  return left === right;
}

/**
 * The version to send with the next save, given the one in hand and one that
 * just arrived with the page. Page data can be older than a save this device
 * already made, so the version never moves backwards.
 */
export function laterLineVersion(current: string, incoming: string): string {
  const currentTime = Date.parse(current);
  const incomingTime = Date.parse(incoming);
  if (Number.isNaN(incomingTime)) return current;
  if (Number.isNaN(currentTime)) return incoming;
  return incomingTime > currentTime ? incoming : current;
}
