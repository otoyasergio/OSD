import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { scanGmailAuthorizationUrl } from "@/lib/email/gmail";
import { readUnreadScanMail } from "@/lib/email/scanInbox";

describe("scanGmailAuthorizationUrl", () => {
  it("asks Google for read-only access to the diagnostics mailbox", () => {
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
    expect(url.searchParams.get("login_hint")).toBe("diagnostics@torontomoto.com");
  });
});

describe("readUnreadScanMail", () => {
  it("lists unread messages and does not call the send endpoint", async () => {
    const plain = Buffer.from("P0301 Misfire", "utf8").toString("base64url");
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "access-1" }), {
          status: 200,
        });
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
        return new Response(JSON.stringify({ messages: [{ id: "m1" }] }), {
          status: 200,
        });
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

  it("reads a TopGuru PDF attachment when the message body is empty", async () => {
    const pdf = readFileSync("tests/fixtures/topguru-min.pdf").toString("base64url");
    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "access-1" }), {
          status: 200,
        });
      }
      if (href.includes("/attachments/att-1")) {
        return new Response(JSON.stringify({ data: pdf }), { status: 200 });
      }
      if (href.includes("/messages/m-pdf")) {
        return new Response(
          JSON.stringify({
            id: "m-pdf",
            snippet: "",
            payload: {
              mimeType: "multipart/mixed",
              headers: [
                { name: "Subject", value: "Full System Report" },
                { name: "From", value: "TopGuru <reports@topdon.example>" },
              ],
              parts: [
                {
                  mimeType: "application/pdf",
                  filename: "BMW-R1250GS-2018_Pre-Scan_FullSystemReport.pdf",
                  body: { attachmentId: "att-1" },
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (href.includes("/messages?")) {
        return new Response(JSON.stringify({ messages: [{ id: "m-pdf" }] }), {
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    });

    const result = await readUnreadScanMail({
      refreshToken: "refresh-1",
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.messages[0]?.text).toContain("WB10J9303KZH99235");
    expect(result.messages[0]?.text).toContain(
      "480682 ABS: Pullaway assistant deactivated"
    );
    expect(result.messages[0]?.text).not.toContain("FullSystemReport.pdf");
  });
});

function initUnused(calls: unknown[][]): boolean {
  return calls.every((call) => {
    const init = call[1] as RequestInit | undefined;
    return !String(init?.body ?? "").includes("raw");
  });
}
