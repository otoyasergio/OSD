import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runbook = readFileSync("docs/ops/wix-inbox-sms.md", "utf8");
const checklist = readFileSync(
  "docs/superpowers/acceptance/production-checklist.md",
  "utf8"
);

describe("Wix SMS cutover and Voice runbooks", () => {
  it.each([
    ["operations runbook", runbook],
    ["production checklist", checklist],
  ])("requires retired Twilio SMS variables to be removed in the %s", (_name, text) => {
    expect(text).toContain("TWILIO_MESSAGING_SERVICE_SID");
    expect(text).toContain("TWILIO_FROM_NUMBER");
    expect(text).toMatch(/remove|delete/i);
    expect(text).toMatch(/before.*cutover|before.*enable/i);
  });

  it("forbids immutable pre-cutover rollback and requires current main", () => {
    expect(runbook).toMatch(/do not.*immutable.*pre-cutover/i);
    expect(runbook).toMatch(/disable.*Wix SMS/i);
    expect(runbook).toContain("git pull --ff-only origin main");
    expect(runbook).toContain("npm run deploy:production");
  });

  it("retains controlled manual inbound/outbound Voice and Video smoke", () => {
    expect(checklist).toMatch(/controlled manual/i);
    expect(checklist).toMatch(/inbound Voice/i);
    expect(checklist).toMatch(/outbound Voice/i);
    expect(checklist).toMatch(/Video/i);
  });
});
