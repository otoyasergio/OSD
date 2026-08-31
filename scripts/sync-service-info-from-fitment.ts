#!/usr/bin/env npx tsx
/**
 * Backfill / refresh motorcycle service-info fields from fitment_vehicle.
 *
 * Usage:
 *   npx tsx scripts/sync-service-info-from-fitment.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { syncAllMotorcycleServiceInfoFromFitment } from "../lib/services/syncServiceInfoFromFitment";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

async function main() {
  const result = await syncAllMotorcycleServiceInfoFromFitment();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
