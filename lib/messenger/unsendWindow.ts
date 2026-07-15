const UNSEND_WINDOW_MS = 15 * 60 * 1000;

export function canUnsendMessage(createdAt: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() <= UNSEND_WINDOW_MS;
}
