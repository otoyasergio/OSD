export function isConversationUnread(args: {
  lastMessageAt: string | null;
  lastReadAt: string | null;
  muted: boolean;
}): boolean {
  if (args.muted) return false;
  const lastAt = args.lastMessageAt ? new Date(args.lastMessageAt).getTime() : 0;
  const readAt = args.lastReadAt ? new Date(args.lastReadAt).getTime() : 0;
  return Boolean(lastAt && lastAt > readAt);
}
