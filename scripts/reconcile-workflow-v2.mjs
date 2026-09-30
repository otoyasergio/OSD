#!/usr/bin/env node
/**
 * Workflow V2 backfill / reconciliation driver.
 *
 * Modes:
 *   node scripts/reconcile-workflow-v2.mjs             # dry-run report
 *   node scripts/reconcile-workflow-v2.mjs --apply     # apply backfill batches
 *   node scripts/reconcile-workflow-v2.mjs --verify    # parity check only
 *
 * Refuses to run against the production project unless --allow-production is
 * passed explicitly AND WORKFLOW_V2_PRODUCTION_MIGRATION=1 is set (the
 * rehearsed cutover). Uses TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY
 * when present so QA runs never need production credentials in the shell.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PRODUCTION_REF = "eofxprepuajpqyvlolhw";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1);
  }
}

loadEnvLocal();

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const verifyOnly = args.has("--verify");
const allowProduction = args.has("--allow-production");

const url = process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase URL / service role key env.");
  process.exit(1);
}

const isProduction = url.includes(PRODUCTION_REF);
if (isProduction && apply) {
  if (!allowProduction || process.env.WORKFLOW_V2_PRODUCTION_MIGRATION !== "1") {
    console.error(
      "REFUSED: applying backfill against PRODUCTION requires --allow-production " +
        "and WORKFLOW_V2_PRODUCTION_MIGRATION=1 (rehearsed cutover only)."
    );
    process.exit(2);
  }
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runBackfill() {
  let totalWorkOrders = 0;
  let totalJobs = 0;
  let totalAnomalies = 0;
  let batch = 0;

  for (;;) {
    const { data, error } = await admin.rpc("workflow_v2_backfill_batch", {
      p_limit: 200,
      p_apply: apply,
    });
    if (error) {
      console.error("Backfill batch failed:", error.message);
      process.exit(1);
    }
    batch += 1;
    totalWorkOrders += data.work_orders_processed;
    totalJobs += data.jobs_processed;
    totalAnomalies += data.anomalies_found;
    console.log(
      `batch ${batch}: work_orders=${data.work_orders_processed} jobs=${data.jobs_processed} anomalies=${data.anomalies_found}`
    );
    if (data.work_orders_processed === 0) break;
    // Dry-run never consumes the NULL lifecycle marker, so one batch is the report.
    if (!apply) break;
  }

  console.log(
    `\n${apply ? "APPLIED" : "DRY-RUN"}: work_orders=${totalWorkOrders} jobs=${totalJobs} anomalies=${totalAnomalies}`
  );
}

async function reportAnomalies() {
  const { data, error } = await admin
    .from("workflow_v2_anomaly")
    .select("entity_type, code, blocking, work_order_id")
    .is("resolved_at", null);
  if (error) {
    console.error("Anomaly query failed:", error.message);
    process.exit(1);
  }
  const blocking = (data ?? []).filter((row) => row.blocking);
  const byCode = new Map();
  for (const row of data ?? []) {
    byCode.set(row.code, (byCode.get(row.code) ?? 0) + 1);
  }
  console.log("\nOpen anomalies by code:");
  if (byCode.size === 0) console.log("  none");
  for (const [code, count] of byCode) console.log(`  ${code}: ${count}`);
  if (blocking.length > 0) {
    console.error(`\nBLOCKING anomalies: ${blocking.length} — cutover must not proceed.`);
    process.exitCode = 3;
  } else {
    console.log("\nNo blocking anomalies.");
  }
}

async function verifyParity() {
  // Legacy status vs V2 facet parity for representable rows.
  const { data: mismatches, error } = await admin
    .from("work_order")
    .select("work_order_id, status, lifecycle_state")
    .not("lifecycle_state", "is", null);
  if (error) {
    console.error("Parity query failed:", error.message);
    process.exit(1);
  }
  const expected = {
    draft: "draft",
    completed: "closed",
    cancelled: "cancelled",
    on_hold: "on_hold",
  };
  let bad = 0;
  for (const row of mismatches ?? []) {
    const want = expected[row.status] ?? "active";
    if (row.lifecycle_state !== want) {
      bad += 1;
      console.error(
        `MISMATCH work_order ${row.work_order_id}: status=${row.status} lifecycle=${row.lifecycle_state}`
      );
    }
  }
  const { count: unmigrated } = await admin
    .from("work_order")
    .select("work_order_id", { count: "exact", head: true })
    .is("lifecycle_state", null);
  console.log(
    `\nParity: checked=${mismatches?.length ?? 0} mismatches=${bad} unmigrated=${unmigrated ?? 0}`
  );
  if (bad > 0) process.exitCode = 4;
}

console.log(
  `Workflow V2 reconcile — target=${isProduction ? "PRODUCTION" : "isolated"} mode=${
    verifyOnly ? "verify" : apply ? "apply" : "dry-run"
  }`
);

if (verifyOnly) {
  await verifyParity();
  await reportAnomalies();
} else {
  await runBackfill();
  await reportAnomalies();
  if (apply) await verifyParity();
}
