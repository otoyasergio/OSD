import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const smokeSource = readFileSync("tests/e2e/smoke.spec.ts", "utf8");

describe("E2E webhook smoke coverage", () => {
  it("does not probe retired Twilio SMS routes", () => {
    expect(smokeSource).not.toContain("/api/twilio/webhooks");
    expect(smokeSource).not.toContain("/api/twilio/status");
  });

  it("keeps the Twilio Voice signature probe", () => {
    expect(smokeSource).toContain("/api/twilio/voice/inbound");
  });
});
