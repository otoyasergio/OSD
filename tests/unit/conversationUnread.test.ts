import { describe, expect, it } from "vitest";
import { isConversationUnread } from "@/lib/messenger/unread";

describe("isConversationUnread", () => {
  it("is unread when the last message is newer than last read", () => {
    expect(
      isConversationUnread({
        lastMessageAt: "2026-08-25T12:00:00.000Z",
        lastReadAt: "2026-08-25T11:00:00.000Z",
        muted: false,
      })
    ).toBe(true);
  });

  it("is not unread when muted or already caught up", () => {
    expect(
      isConversationUnread({
        lastMessageAt: "2026-08-25T12:00:00.000Z",
        lastReadAt: "2026-08-25T11:00:00.000Z",
        muted: true,
      })
    ).toBe(false);
    expect(
      isConversationUnread({
        lastMessageAt: "2026-08-25T12:00:00.000Z",
        lastReadAt: "2026-08-25T12:00:00.000Z",
        muted: false,
      })
    ).toBe(false);
    expect(
      isConversationUnread({
        lastMessageAt: null,
        lastReadAt: null,
        muted: false,
      })
    ).toBe(false);
  });
});
