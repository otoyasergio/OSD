import { describe, expect, it, vi } from "vitest";
import { scanGmailAuthorizationUrl } from "@/lib/email/gmail";
import { readUnreadScanMail } from "@/lib/email/scanInbox";

describe("scanGmailAuthorizationUrl", () => {
  it("asks Google for read-only access to the scans mailbox", () => {
    const url = new URL(
      scanGmailAuthorizationUrl({
        clientId: "client-id",
        redirectUri: "https://service.torontomoto.com/api/google/mail/callback",
        state: "state-1",
      })
    );

    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scope).toContain("https://www.googleapis.com/auth/userinfo.email");
    expect(scope).not.toContain("gmail.send");
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    expect(url.searchParams.get("login_hint")).toBe("scans@torontomoto.com");
  });
});

describe("readUnreadScanMail", () => {
  it("lists unread messages and does not call the send endpoint", async () => {
    const plain = Buffer.from("P0301 Misfire", "utf8").toString("base64url");
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "access-1" }), { status: 200 });
      }
      if (href.includes("/messages/m1")) {
        return new Response(
          JSON.stringify({
            id: "m1",
            snippet: "",
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "Subject", value: "TopScan report" },
                { name: "From", value: "tech@shop.example" },
              ],
              body: { data: plain },
            },
          }),
          { status: 200 }
        );
      }
      if (href.includes("/messages?")) {
        return new Response(JSON.stringify({ messages: [{ id: "m1" }] }), { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    });

    const result = await readUnreadScanMail({
      refreshToken: "refresh-1",
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.refreshToken).toBeNull();
    expect(result.messages).toEqual([
      {
        id: "m1",
        subject: "TopScan report",
        from: "tech@shop.example",
        text: expect.stringContaining("P0301 Misfire"),
      },
    ]);
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/messages/send"))).toBe(false);
    expect(initUnused(fetchImpl.mock.calls)).toBe(true);
  });
});

function initUnused(calls: unknown[][]): boolean {
  return calls.every((call) => {
    const init = call[1] as RequestInit | undefined;
    return !String(init?.body ?? "").includes("raw");
  });
}
