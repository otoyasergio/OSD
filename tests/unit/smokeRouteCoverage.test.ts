import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const smokeSource = readFileSync("tests/e2e/smoke.spec.ts", "utf8");

describe("E2E webhook smoke coverage", () => {
  it("keeps retired Twilio SMS route files deleted", () => {
    expect(existsSync("app/api/twilio/webhooks/route.ts")).toBe(false);
    expect(existsSync("app/api/twilio/status/route.ts")).toBe(false);
  });

  it("keeps the Twilio Voice signature probe", () => {
    expect(smokeSource).toContain("/api/twilio/voice/inbound");
  });
});
