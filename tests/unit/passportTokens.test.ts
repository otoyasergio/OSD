import { describe, expect, it } from "vitest";
import {
  generatePassportShareToken,
  hashPassportShareToken,
  passportShareExpiry,
  passportShareStatus,
  passportShareUrl,
} from "@/lib/passport/tokens";

describe("passport share tokens", () => {
  it("generates an opaque token and stores a deterministic SHA-256 hash", () => {
    const generated = generatePassportShareToken();

    expect(generated.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.hash).toBe(hashPassportShareToken(generated.token));
    expect(generated.hash).not.toContain(generated.token);
  });

  it("builds the dedicated public passport URL", () => {
    expect(passportShareUrl("secret-token", "https://service.torontomoto.com/")).toBe(
      "https://service.torontomoto.com/p/secret-token"
    );
  });

  it("defaults grants to seven days", () => {
    expect(passportShareExpiry(new Date("2026-10-31T02:30:00.000Z"))).toBe(
      "2026-11-07T02:30:00.000Z"
    );
  });

  it("derives active, expired, and revoked states without exposing the token", () => {
    const now = new Date("2026-10-31T02:30:00.000Z");
    expect(
      passportShareStatus(
        { expires_at: "2026-11-07T02:30:00.000Z", revoked_at: null },
        now
      )
    ).toBe("active");
    expect(
      passportShareStatus(
        { expires_at: "2026-10-30T02:30:00.000Z", revoked_at: null },
        now
      )
    ).toBe("expired");
    expect(
      passportShareStatus(
        {
          expires_at: "2026-11-07T02:30:00.000Z",
          revoked_at: "2026-10-30T02:30:00.000Z",
        },
        now
      )
    ).toBe("revoked");
  });
});
