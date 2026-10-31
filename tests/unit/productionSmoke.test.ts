import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

type IntegrationStatus = "ok" | "missing";

let server: ReturnType<typeof createServer> | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve()))
    );
    server = null;
  }
});

async function runSmoke(input: {
  wixSms: IntegrationStatus;
  twilioVoice: IntegrationStatus;
}): Promise<{ code: number | null; output: string }> {
  server = createServer((request, response) => {
    if (request.url === "/api/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          ok: true,
          integrations: {
            supabase: "ok",
            wixSms: input.wixSms,
            twilioVoice: input.twilioVoice,
          },
        })
      );
      return;
    }

    if (request.url === "/login") {
      response.statusCode = 200;
    } else {
      response.statusCode = 401;
    }
    response.end();
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/smoke-production.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BASE_URL: `http://127.0.0.1:${port}`,
        CRON_SECRET: "",
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe("production smoke health contract", () => {
  it.each([
    ["Wix SMS", { wixSms: "missing", twilioVoice: "ok" }],
    ["Twilio Voice", { wixSms: "ok", twilioVoice: "missing" }],
  ] as const)("fails when %s readiness is missing", async (_name, integrations) => {
    const result = await runSmoke(integrations);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/health endpoint/);
  });

  it("accepts both configured messaging and calling providers", async () => {
    const result = await runSmoke({ wixSms: "ok", twilioVoice: "ok" });

    expect(result.code).toBe(0);
  });
});
