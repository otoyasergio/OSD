import { describe, expect, it } from "vitest";
import { bearerAuthorizationMatches } from "@/lib/security/webhooks";

describe("bearerAuthorizationMatches", () => {
  it("accepts an exact Bearer secret", () => {
    expect(bearerAuthorizationMatches("Bearer cron-secret", "cron-secret")).toBe(true);
  });

  it("rejects a same-length wrong secret", () => {
    expect(bearerAuthorizationMatches("Bearer cron-secret", "cron-secreX")).toBe(false);
  });

  it("rejects a different-length secret without throwing", () => {
    expect(bearerAuthorizationMatches("Bearer short", "a-much-longer-secret")).toBe(
      false
    );
  });

  it("rejects a missing header, an empty secret, and a non-Bearer scheme", () => {
    expect(bearerAuthorizationMatches(null, "cron-secret")).toBe(false);
    expect(bearerAuthorizationMatches("Bearer cron-secret", "")).toBe(false);
    expect(bearerAuthorizationMatches("Basic cron-secret", "cron-secret")).toBe(false);
  });
});
