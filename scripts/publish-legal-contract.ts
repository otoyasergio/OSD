#!/usr/bin/env npx tsx
/**
 * Publish the Otomoto legal contract as the active drop-off agreement template.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

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

const INITIAL_FIELDS = [
  "terms_warning",
  "maintenance",
  "pickup",
  "ride_move",
  "liability",
  "media",
  "payment",
  "ownership",
  "fuel",
  "ai_privacy",
  "acknowledgement",
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const bodyHtml = readFileSync(
    resolve(process.cwd(), "scripts/data/otomoto-legal-contract.html"),
    "utf8"
  ).trim();

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const version = "2026-07-12-legal";

  await admin
    .from("drop_off_agreement_template")
    .update({ active: false })
    .eq("active", true);

  const { data, error } = await admin
    .from("drop_off_agreement_template")
    .insert({
      version,
      title: "Legal Terms and Conditions",
      body_html: bodyHtml,
      initial_fields: INITIAL_FIELDS,
      active: true,
    })
    .select("template_id, version, title")
    .single();

  if (error) throw error;
  console.log(`Published active contract template: ${data.title} (${data.version})`);
  console.log(`Initial fields: ${INITIAL_FIELDS.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
