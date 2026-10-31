import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

describe("Twilio readiness check", () => {
  it("checks Voice and Video without inspecting the retired SMS surface", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/check-twilio.mjs")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TWILIO_ACCOUNT_SID: "",
          TWILIO_AUTH_TOKEN: "",
          TWILIO_API_KEY_SID: "",
          TWILIO_API_KEY_SECRET: "",
          TWILIO_TWIML_APP_SID: "",
          TWILIO_MESSAGING_SERVICE_SID: "malformed-retired-value",
          TWILIO_FROM_NUMBER: "malformed-retired-value",
        },
      }
    );

    const output = `${result.stdout}\n${result.stderr}`;

    expect(output).toContain("Messenger video calls");
    expect(output).toContain("Shop phone / staff voice");
    expect(output).not.toMatch(
      /SMS|TWILIO_MESSAGING_SERVICE_SID|TWILIO_FROM_NUMBER|\/api\/twilio\/(?:webhooks|status)/
    );
  });
});
