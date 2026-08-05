/**
 * One-off / ops script: pull Wix contacts into Supabase `customer`.
 * Usage: npx tsx scripts/sync-wix-contacts.ts
 *
 * Standalone (no Next.js imports) so it can run outside `next dev`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { listAllWixContacts } from "../lib/wix/client";
import {
  extractWixContactFields,
  findMatchingCustomer,
  isCustomerInSyncWithWix,
  type CustomerMatchRow,
} from "../lib/wix/contactNormalize";

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

const MATCH_COLUMNS = "customer_id, first_name, last_name, email, phone, wix_contact_id";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!process.env.WIX_API_KEY?.trim() || !process.env.WIX_SITE_ID?.trim()) {
    throw new Error("WIX_NOT_CONFIGURED");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const started = Date.now();
  console.log("Fetching Wix contacts…");
  const wixContacts = await listAllWixContacts();
  console.log(`Fetched ${wixContacts.length} Wix contacts in ${Date.now() - started}ms`);

  console.log("Loading local customers…");
  const localRows: CustomerMatchRow[] = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("customer")
      .select(MATCH_COLUMNS)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data as CustomerMatchRow[]) ?? [];
    localRows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  console.log(`Loaded ${localRows.length} local customers`);

  const stats = {
    scanned: wixContacts.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    triggered_by: "manual",
  };

  for (let i = 0; i < wixContacts.length; i++) {
    const contact = wixContacts[i];
    const fields = extractWixContactFields(contact);
    if (!fields) {
      stats.skipped += 1;
      continue;
    }

    try {
      const existing = findMatchingCustomer(localRows, {
        wixContactId: fields.wixContactId,
        email: fields.email,
        phone: fields.phone,
      });

      if (existing && isCustomerInSyncWithWix(existing, fields)) {
        stats.unchanged += 1;
      } else if (existing) {
        const { error } = await supabase
          .from("customer")
          .update({
            first_name: fields.firstName,
            last_name: fields.lastName,
            email: fields.email ?? existing.email,
            phone: fields.phone ?? existing.phone,
            wix_contact_id: fields.wixContactId,
            updated_at: new Date().toISOString(),
          })
          .eq("customer_id", existing.customer_id);
        if (error) throw error;
        stats.updated += 1;
        const idx = localRows.findIndex(
          (row) => row.customer_id === existing.customer_id
        );
        if (idx >= 0) {
          localRows[idx] = {
            ...localRows[idx],
            first_name: fields.firstName,
            last_name: fields.lastName,
            email: fields.email ?? localRows[idx].email,
            phone: fields.phone ?? localRows[idx].phone,
            wix_contact_id: fields.wixContactId,
          };
        }
      } else {
        const { data, error } = await supabase
          .from("customer")
          .insert({
            first_name: fields.firstName,
            last_name: fields.lastName,
            email: fields.email,
            phone: fields.phone,
            wix_contact_id: fields.wixContactId,
          })
          .select("customer_id")
          .single();
        if (error) throw error;
        stats.created += 1;
        localRows.push({
          customer_id: data.customer_id as string,
          first_name: fields.firstName,
          last_name: fields.lastName,
          email: fields.email,
          phone: fields.phone,
          wix_contact_id: fields.wixContactId,
        });
      }
    } catch {
      stats.failed += 1;
    }

    if ((i + 1) % 100 === 0 || i + 1 === wixContacts.length) {
      console.log(
        `Progress ${i + 1}/${wixContacts.length} created=${stats.created} updated=${stats.updated} unchanged=${stats.unchanged} skipped=${stats.skipped} failed=${stats.failed}`
      );
    }
  }

  console.log(JSON.stringify({ ...stats, duration_ms: Date.now() - started }, null, 2));
}

main().catch((error) => {
  console.error(
    "Wix contacts sync failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
