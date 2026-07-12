/**
 * One-off / ops script: sync Parts Canada inventory into Supabase.
 * Usage: npx tsx scripts/sync-parts-canada.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { unzipSync, strFromU8 } from "fflate";
import { parseInventoryCsv } from "../lib/partsCanada/parseInventory";

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

const apiUrl = (
  process.env.PARTS_CANADA_API_URL ?? "https://sandbox-api.partscanada.com/api/v2"
).replace(/\/$/, "");
const apiKey = process.env.PARTS_CANADA_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!apiKey || !supabaseUrl || !serviceKey) {
  console.error("Missing PARTS_CANADA_API_KEY, Supabase URL, or service role key");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BATCH = 500;

async function main() {
  console.log("Starting Parts Canada sync…");
  const { data: run, error: runError } = await admin
    .from("parts_canada_sync_run")
    .insert({ status: "running", triggered_by: "manual" })
    .select("sync_run_id")
    .single();
  if (runError) throw runError;

  try {
    const response = await fetch(`${apiUrl}/inventory`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "*/*" },
    });
    console.log("Parts Canada HTTP", response.status);
    if (!response.ok) {
      throw new Error(`PARTS_CANADA_HTTP_${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));
    const csvEntry = Object.entries(unzipped).find(([name]) =>
      name.toLowerCase().endsWith(".csv")
    );
    if (!csvEntry) throw new Error("PARTS_CANADA_INVENTORY_INVALID");

    const rows = parseInventoryCsv(strFromU8(csvEntry[1]!));
    console.log(`Parsed ${rows.length} rows`);

    // CSV can contain duplicate part numbers in one file; upsert batches cannot.
    const byPartNumber = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      byPartNumber.set(row.part_number, row);
    }
    const uniqueRows = [...byPartNumber.values()];
    console.log(`Unique part numbers: ${uniqueRows.length}`);

    const syncedAt = new Date().toISOString();
    for (let i = 0; i < uniqueRows.length; i += BATCH) {
      const slice = uniqueRows.slice(i, i + BATCH).map((row) => ({
        ...row,
        synced_at: syncedAt,
        updated_at: syncedAt,
      }));
      const { error } = await admin
        .from("parts_canada_catalog")
        .upsert(slice, { onConflict: "part_number" });
      if (error) throw error;
      console.log(
        `Upserted ${Math.min(i + BATCH, uniqueRows.length)} / ${uniqueRows.length}`
      );
    }

    await admin
      .from("parts_canada_sync_run")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        row_count: uniqueRows.length,
      })
      .eq("sync_run_id", run.sync_run_id);

    console.log("Done:", uniqueRows.length, "rows");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from("parts_canada_sync_run")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message.slice(0, 500),
      })
      .eq("sync_run_id", run.sync_run_id);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
