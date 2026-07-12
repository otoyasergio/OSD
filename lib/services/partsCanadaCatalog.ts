import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { downloadInventoryCatalog } from "@/lib/partsCanada/client";
import { isPartsCanadaConfigured } from "@/lib/partsCanada/config";
import {
  supplierStockTotal,
  type PartsCanadaCatalogRow,
} from "@/lib/partsCanada/parseInventory";
import {
  canOrderPart,
  canSyncPartsCanadaCatalog,
  canViewPartCost,
} from "@/lib/permissions";

export type PartsCanadaSearchHit = {
  part_number: string;
  brand: string | null;
  description_en: string | null;
  msrp: number | null;
  /** Only populated when the caller may view cost. */
  dealer_price: number | null;
  stock: number | null;
  qty_cal: number | null;
  qty_lon: number | null;
};

export type PartsCanadaSyncStatus = {
  configured: boolean;
  last_run: {
    status: "running" | "succeeded" | "failed";
    started_at: string;
    finished_at: string | null;
    row_count: number | null;
    error_message: string | null;
    triggered_by: string | null;
  } | null;
  catalog_count: number;
};

const BATCH_SIZE = 500;

function mapSearchHit(
  row: {
    part_number: string;
    brand: string | null;
    description_en: string | null;
    msrp: number | null;
    dealer_price: number | null;
    qty_cal: number | null;
    qty_lon: number | null;
  },
  includeCost: boolean
): PartsCanadaSearchHit {
  return {
    part_number: row.part_number,
    brand: row.brand,
    description_en: row.description_en,
    msrp: row.msrp,
    dealer_price: includeCost ? row.dealer_price : null,
    stock: supplierStockTotal(row.qty_cal, row.qty_lon),
    qty_cal: row.qty_cal,
    qty_lon: row.qty_lon,
  };
}

export async function getPartsCanadaSyncStatus(): Promise<PartsCanadaSyncStatus> {
  const user = await requireUser();
  if (!canOrderPart(user.role) && !canSyncPartsCanadaCatalog(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const supabase = await createClient();
  const [{ count }, { data: lastRun }] = await Promise.all([
    supabase
      .from("parts_canada_catalog")
      .select("part_number", { count: "exact", head: true }),
    supabase
      .from("parts_canada_sync_run")
      .select(
        "status, started_at, finished_at, row_count, error_message, triggered_by"
      )
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    configured: isPartsCanadaConfigured(),
    last_run: lastRun
      ? {
          status: lastRun.status as "running" | "succeeded" | "failed",
          started_at: lastRun.started_at,
          finished_at: lastRun.finished_at,
          row_count: lastRun.row_count,
          error_message: lastRun.error_message,
          triggered_by: lastRun.triggered_by,
        }
      : null,
    catalog_count: count ?? 0,
  };
}

export async function searchPartsCanadaCatalog(
  query: string,
  options?: { limit?: number }
): Promise<PartsCanadaSearchHit[]> {
  const user = await requireUser();
  if (!canOrderPart(user.role)) throw new Error("FORBIDDEN");

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 50);
  const supabase = await createClient();
  const includeCost = canViewPartCost(user.role);
  const safe = trimmed.replace(/[%_,.()]/g, " ").replace(/\s+/g, " ").trim();
  if (safe.length < 2) return [];
  const like = `%${safe}%`;

  const { data, error } = await supabase
    .from("parts_canada_catalog")
    .select(
      "part_number, brand, description_en, msrp, dealer_price, qty_cal, qty_lon"
    )
    .or(
      [
        `part_number.ilike.${JSON.stringify(like)}`,
        `manufacturer_part_number.ilike.${JSON.stringify(like)}`,
        `brand.ilike.${JSON.stringify(like)}`,
        `description_en.ilike.${JSON.stringify(like)}`,
      ].join(",")
    )
    .order("part_number", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => mapSearchHit(row, includeCost));
}

async function upsertCatalogBatches(
  rows: PartsCanadaCatalogRow[],
  syncedAt: string
): Promise<void> {
  const admin = createAdminClient();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE).map((row) => ({
      ...row,
      synced_at: syncedAt,
      updated_at: syncedAt,
    }));

    const { error } = await admin
      .from("parts_canada_catalog")
      .upsert(slice, { onConflict: "part_number" });

    if (error) throw error;
  }
}

/**
 * Full inventory sync. Safe to call from cron (no session) or manual (with user).
 */
export async function syncPartsCanadaCatalog(options: {
  triggeredBy: "cron" | "manual";
  triggeredByUserId?: string | null;
}): Promise<{ row_count: number }> {
  if (!isPartsCanadaConfigured()) {
    throw new Error("PARTS_CANADA_NOT_CONFIGURED");
  }

  const admin = createAdminClient();
  const { data: run, error: runError } = await admin
    .from("parts_canada_sync_run")
    .insert({
      status: "running",
      triggered_by: options.triggeredBy,
      triggered_by_user_id: options.triggeredByUserId ?? null,
    })
    .select("sync_run_id")
    .single();

  if (runError) throw runError;

  try {
    const rows = await downloadInventoryCatalog();
    const syncedAt = new Date().toISOString();

    // CSV can contain duplicate part numbers; a single upsert batch cannot.
    const byPartNumber = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      byPartNumber.set(row.part_number, row);
    }
    const uniqueRows = [...byPartNumber.values()];

    await upsertCatalogBatches(uniqueRows, syncedAt);

    const { error: finishError } = await admin
      .from("parts_canada_sync_run")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        row_count: uniqueRows.length,
      })
      .eq("sync_run_id", run.sync_run_id);

    if (finishError) throw finishError;
    return { row_count: uniqueRows.length };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PARTS_CANADA_SYNC_FAILED";
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

export async function runManualPartsCanadaSync(): Promise<{ row_count: number }> {
  const user = await requireUser();
  if (!canSyncPartsCanadaCatalog(user.role)) throw new Error("FORBIDDEN");
  return syncPartsCanadaCatalog({
    triggeredBy: "manual",
    triggeredByUserId: user.user_id,
  });
}
