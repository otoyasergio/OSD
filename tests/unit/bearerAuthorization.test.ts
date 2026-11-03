import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bearerAuthorizationMatches } from "@/lib/security/webhooks";

const INBOUND_BEARER_ROUTES = [
  "app/api/cron/parts-canada-sync/route.ts",
  "app/api/cron/weekly-shop-report/route.ts",
  "app/api/cron/wix-contacts-sync/route.ts",
  "app/api/wix/webhooks/invoices/route.ts",
  "app/api/wix/webhooks/contacts/route.ts",
  "app/api/wix/webhooks/bookings/route.ts",
];

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

describe("inbound bearer routes", () => {
  it("compares the shared secret with bearerAuthorizationMatches", () => {
    for (const path of INBOUND_BEARER_ROUTES) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("bearerAuthorizationMatches(");
      expect(source, path).not.toContain("!== `Bearer");
    }
  });
});
