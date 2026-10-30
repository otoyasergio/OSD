import { beforeEach, describe, expect, it, vi } from "vitest";
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import { customerEmailLocationAllowed } from "@/lib/email/config";
import {
  buildGmailMime,
  exchangeGmailAuthorizationCode,
  gmailAuthorizationUrl,
  revokeGmailRefreshToken,
  sendGmailApiMessage,
  toGmailRaw,
} from "@/lib/email/gmail";

describe("gmailAuthorizationUrl", () => {
  it("asks Google for offline send access and a refresh token", () => {
    const url = new URL(
      gmailAuthorizationUrl({
        clientId: "client-id",
        redirectUri: "https://service.torontomoto.com/api/google/mail/callback",
        state: "state-1",
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://service.torontomoto.com/api/google/mail/callback"
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("state")).toBe("state-1");
  });
});

describe("buildGmailMime", () => {
  it("sends as the legal entity from the connected mailbox", () => {
    const mime = buildGmailMime({
      fromAddress: "info@torontomoto.com",
      to: "ada@example.com",
      subject: "Ready for pickup — WO-1",
      text: "Ready at 99 River Street",
      html: "<p>Ready</p>",
      boundary: "boundary",
    });

    expect(mime).toContain(`From: "${TORONTO_SHOP.legalName}" <info@torontomoto.com>`);
    expect(mime).toContain("To: ada@example.com");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).not.toContain("Subject: Ready for pickup —");
    const decoded = Buffer.from(toGmailRaw(mime), "base64url").toString("utf8");
    expect(decoded).toBe(mime);
  });

  it("keeps injected line breaks out of the headers", () => {
    const mime = buildGmailMime({
      fromAddress: "info@torontomoto.com",
      to: "ada@example.com\r\nBcc: evil@example.com",
      subject: "Hello\nBcc: evil@example.com",
      text: "Hi",
      html: "<p>Hi</p>",
      boundary: "boundary",
    });

    expect(mime.split("\r\n").some((line) => line.startsWith("Bcc:"))).toBe(false);
    expect(mime).toContain("To: ada@example.com Bcc: evil@example.com");
  });
});

describe("sendGmailApiMessage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes an access token and sends the raw message", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "access-1" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    });

    const result = await sendGmailApiMessage({
      refreshToken: "refresh-1",
      clientId: "client",
      clientSecret: "secret",
      fromAddress: "info@torontomoto.com",
      to: "ada@example.com",
      subject: "Ready",
      html: "<p>Ready</p>",
      text: "Ready",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ id: "msg-1", refreshToken: null });
    const sendCall = fetchImpl.mock.calls[1];
    expect(String(sendCall?.[0])).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    );
    const body = JSON.parse(String(sendCall?.[1]?.body));
    const mime = Buffer.from(body.raw, "base64url").toString("utf8");
    expect(mime).toContain("info@torontomoto.com");
    expect(mime).toContain(TORONTO_SHOP.legalName);
  });

  it("asks the owner to reconnect when Google rejects the refresh token", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    });

    await expect(
      sendGmailApiMessage({
        refreshToken: "stale",
        clientId: "client",
        clientSecret: "secret",
        fromAddress: "info@torontomoto.com",
        to: "ada@example.com",
        subject: "Ready",
        html: "<p>Ready</p>",
        text: "Ready",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow("GMAIL_RECONNECT_REQUIRED");
  });
});

describe("customerEmailLocationAllowed", () => {
  it("sends customer email for the Toronto shop only", () => {
    expect(customerEmailLocationAllowed("TOR")).toBe(true);
    expect(customerEmailLocationAllowed("OTT")).toBe(false);
    expect(customerEmailLocationAllowed(null)).toBe(false);
  });
});

describe("revokeGmailRefreshToken", () => {
  it("asks Google to revoke the stored refresh token", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(null, { status: 200 });
    });
    await revokeGmailRefreshToken("refresh-1", fetchImpl as unknown as typeof fetch);
    const call = fetchImpl.mock.calls[0];
    expect(String(call?.[0])).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(call?.[1]?.body)).toBe("token=refresh-1");
  });
});

describe("exchangeGmailAuthorizationCode", () => {
  it("stores the mailbox address and refresh token from Google", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("userinfo")) {
        return new Response(JSON.stringify({ email: "Info@TorontoMoto.com" }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1" }),
        { status: 200 }
      );
    });

    await expect(
      exchangeGmailAuthorizationCode({
        code: "code-1",
        clientId: "client",
        clientSecret: "secret",
        redirectUri: "https://service.torontomoto.com/api/google/mail/callback",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toEqual({
      refreshToken: "refresh-1",
      emailAddress: "info@torontomoto.com",
    });
  });
});
