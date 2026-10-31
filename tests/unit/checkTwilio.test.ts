import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const doctorPath = resolve(process.cwd(), "scripts/check-twilio.mjs");
const fetchFixture = resolve(process.cwd(), "tests/fixtures/mockTwilioDoctorFetch.mjs");
const configuredEnv = {
  NEXT_PUBLIC_APP_URL: "https://service.torontomoto.com",
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "voice-signature-token",
  TWILIO_API_KEY_SID: `SK${"b".repeat(32)}`,
  TWILIO_API_KEY_SECRET: "api-key-secret",
  TWILIO_TWIML_APP_SID: `AP${"c".repeat(32)}`,
};

describe("Twilio readiness check", () => {
  it("uses a distinct Voice fixture number from the Wix SMS number", () => {
    const source = readFileSync(fetchFixture, "utf8");
    expect(source).not.toContain("+16474241088");
  });

  it("checks Voice and Video without inspecting the retired SMS surface", () => {
    const result = spawnSync(process.execPath, [doctorPath], {
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
    });

    const output = `${result.stdout}\n${result.stderr}`;

    expect(output).toContain("Messenger video calls");
    expect(output).toContain("Shop phone / staff voice");
    expect(output).not.toMatch(
      /SMS|TWILIO_MESSAGING_SERVICE_SID|TWILIO_FROM_NUMBER|\/api\/twilio\/(?:webhooks|status)/
    );
  });

  it("succeeds when one owned number routes Voice here and another is unrelated", () => {
    const result = spawnSync(process.execPath, ["--import", fetchFixture, doctorPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...configuredEnv,
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain(
      "voice webhook → https://service.torontomoto.com/api/twilio/voice/inbound"
    );
    expect(output).toContain(
      "status callback → https://service.torontomoto.com/api/twilio/voice/status"
    );
    expect(output).toContain(
      "Voice URL → https://service.torontomoto.com/api/twilio/voice/outbound"
    );
    expect(output).toContain(
      "Status Callback URL → https://service.torontomoto.com/api/twilio/voice/status"
    );
    expect(output).toContain("+14165550123 (Toronto Voice)");
    expect(output).toContain("+18885550199 (Unrelated toll-free)");
    expect(output).not.toContain("FAIL");
    expect(output).not.toContain("voice is not routed anywhere");
  });

  it("fails when no owned number routes inbound Voice to this app", () => {
    const result = spawnSync(process.execPath, ["--import", fetchFixture, doctorPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...configuredEnv,
        TWILIO_TEST_NO_MATCH: "1",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "no owned phone number routes inbound Voice to https://service.torontomoto.com/api/twilio/voice/inbound"
    );
  });

  it("fails when the production origin is missing because callback URLs cannot be verified", () => {
    const result = spawnSync(process.execPath, ["--import", fetchFixture, doctorPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...configuredEnv,
        NEXT_PUBLIC_APP_URL: "",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toMatch(/NEXT_PUBLIC_APP_URL.*required.*Voice callback/i);
  });

  it("fails if the Wix-owned SMS number appears in the Twilio account", () => {
    const result = spawnSync(process.execPath, ["--import", fetchFixture, doctorPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...configuredEnv,
        TWILIO_TEST_OWNED_NUMBER: "+16474241088",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toMatch(/647-424-1088.*must remain in Wix/i);
  });

  it.each([
    ["number", "TWILIO_TEST_BAD_NUMBER_STATUS"],
    ["TwiML app", "TWILIO_TEST_BAD_APP_STATUS"],
  ])("fails when the %s Voice status callback is not exact", (_name, flag) => {
    const result = spawnSync(process.execPath, ["--import", fetchFixture, doctorPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...configuredEnv,
        [flag]: "1",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain(
      "expected https://service.torontomoto.com/api/twilio/voice/status"
    );
  });
});
