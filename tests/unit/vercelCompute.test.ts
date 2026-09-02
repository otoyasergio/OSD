import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type VercelConfig = {
  fluid?: boolean;
  regions?: string[];
  crons?: Array<{ path: string; schedule: string }>;
  functions?: Record<string, { memory?: number; maxDuration?: number }>;
};

function readVercelConfig(): VercelConfig {
  return JSON.parse(
    readFileSync(join(process.cwd(), "vercel.json"), "utf8")
  ) as VercelConfig;
}

describe("Vercel compute allocation", () => {
  const config = readVercelConfig();

  it("enables Fluid compute so instances are reused instead of one-shot lambdas", () => {
    expect(config.fluid).toBe(true);
  });

  it("pins functions to iad1, matching live traffic and US-East data sources", () => {
    expect(config.regions).toEqual(["iad1"]);
  });

  it("does not set function memory in vercel.json (invalid with Fluid; dashboard only)", () => {
    const functionEntries = Object.values(config.functions ?? {});
    for (const entry of functionEntries) {
      expect(entry.memory).toBeUndefined();
    }
    expect(JSON.stringify(config)).not.toMatch(/"memory"\s*:/);
  });

  it("keeps catalog crons (Parts Canada daily, Wix contacts every 4 minutes)", () => {
    expect(config.crons).toEqual([
      { path: "/api/cron/parts-canada-sync", schedule: "0 15 * * *" },
      { path: "/api/cron/wix-contacts-sync", schedule: "*/4 * * * *" },
    ]);
  });
});
