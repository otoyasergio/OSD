import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const SIGNOFF_FIELDS = [
  "Tester",
  "Device / OS / Safari",
  "Date",
  "Expected result",
  "Result",
  "Artifact link",
  "Blocker / waiver",
];

const FLOWS = [
  "six-photo intake using camera and multi-select library",
  "HEIC, orientation, VIN/odometer legibility at full zoom",
  "camera share/save sheet dismissed and accepted",
  "background, lock, close/reopen, and network-loss resume",
  "low device storage / IndexedDB quota failure copy",
  "multi-tab duplicate protection",
  "inspection multi-photo and Retry",
  "job_work and job_proof",
  "five checkout photos",
  "Ready/Complete block",
  "owner/manager reasoned override",
  "gallery/thumb/lightbox/save-to-device",
  "expired signed URL recovery",
  "profile/chat/customer/staff/motorcycle secondary uploads",
  "delete confirmation/reason",
  "reconciliation read-only report",
  "sign-out/location switch privacy",
];

describe("Safari real-device acceptance runbook", () => {
  it("requires shop devices, flows, signoff fields, and Linux WebKit disclaimer", () => {
    const runbook = source("docs/ops/safari-photo-acceptance.md");
    expect(runbook).toMatch(/shop iPad/i);
    expect(runbook).toMatch(/portrait/i);
    expect(runbook).toMatch(/landscape/i);
    expect(runbook).toMatch(/iPhone Safari/i);
    expect(runbook).toMatch(/macOS/i);
    expect(runbook).toMatch(/Linux Playwright WebKit is not device Safari/i);
    for (const field of SIGNOFF_FIELDS) {
      expect(runbook).toContain(field);
    }
    for (const flow of FLOWS) {
      expect(runbook.toLowerCase()).toContain(flow.toLowerCase());
    }
    expect(runbook).toMatch(/confirmed `job_proof`|confirmed job_proof/i);
  });

  it("documents queue-first then checkout-flag then main-only production order", () => {
    const health = source("docs/ops/platform-health.md");
    expect(health).toMatch(/safari-photo-acceptance\.md/);
    expect(health).toMatch(/PHOTO_UPLOAD_QUEUE_ENABLED/);
    expect(health).toMatch(/CHECKOUT_EVIDENCE_ENABLED/);
    expect(health).toMatch(/durable queue first|queue-first|queue first/i);
    expect(health).toMatch(/migration/i);
    expect(health).toMatch(/reconcile|reconciliation/i);
    expect(health).toMatch(/deploy:production|main only/i);
  });
});
