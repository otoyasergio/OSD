#!/usr/bin/env npx tsx
/**
 * Import fitment_records.csv into Supabase fitment_vehicle table.
 *
 * Usage:
 *   FITMENT_CSV_PATH="/path/to/fitment_records.csv" npx tsx scripts/import-fitment.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { importFitmentRows } from "../lib/services/fitment";

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

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx]?.trim() ?? "";
    });
    rows.push(row);
  }
  return rows;
}

async function main() {
  const path =
    process.env.FITMENT_CSV_PATH ??
    "/Users/segio/wix filter /data/fitment_records.csv";

  const text = readFileSync(path, "utf8");
  const rows = parseCsv(text);
  console.log(`Importing ${rows.length} fitment rows from ${path}…`);
  const result = await importFitmentRows(rows, path);
  console.log(`Done. ${result.row_count} vehicles imported.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
