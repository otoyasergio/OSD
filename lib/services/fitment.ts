import { createAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import { requireUser } from "@/lib/auth/session";
import {
  collectCatalogSkus,
  extractPartNumbers,
  skuLookupVariants,
} from "@/lib/fitment/partMatch";
import { rowCoversYear } from "@/lib/fitment/fitmentRange";
import { fitmentFieldLabel, FITMENT_SPEC_FIELDS } from "@/lib/fitment/fieldLabels";
import { canOrderPart } from "@/lib/permissions";
import type { PartsCanadaSearchHit } from "@/lib/services/partsCanadaCatalog";
import { syncAllMotorcycleServiceInfoFromFitment } from "@/lib/services/syncServiceInfoFromFitment";

export type FitmentVehicle = {
  vehicle_id: string;
  make: string;
  model: string;
  year_start: number;
  year_end: number;
  category: string;
  spec_data: Record<string, string>;
  part_data: Record<string, string>;
};

export type FitmentPartMatch = {
  field: string;
  label: string;
  value: string;
  catalog_hit: PartsCanadaSearchHit | null;
};

const SPEC_KEYS = FITMENT_SPEC_FIELDS;
const BATCH = 500;

export async function getFitmentImportStatus(): Promise<{
  vehicle_count: number;
  last_run: {
    status: string;
    started_at: string;
    row_count: number | null;
  } | null;
}> {
  await requireUser();
  const supabase = await createClient();
  const [{ count }, { data: lastRun }] = await Promise.all([
    supabase.from("fitment_vehicle").select("vehicle_id", { count: "exact", head: true }),
    supabase
      .from("fitment_import_run")
      .select("status, started_at, row_count")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    vehicle_count: count ?? 0,
    last_run: lastRun
      ? {
          status: lastRun.status,
          started_at: lastRun.started_at,
          row_count: lastRun.row_count,
        }
      : null,
  };
}

export async function listFitmentYears(): Promise<number[]> {
  await requireUser();
  const supabase = await createClient();
  const currentYear = new Date().getFullYear();

  const [{ data: minRow, error: minError }, { data: maxRow, error: maxError }] =
    await Promise.all([
      supabase
        .from("fitment_vehicle")
        .select("year_start")
        .order("year_start", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("fitment_vehicle")
        .select("year_end")
        .order("year_end", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (minError) throw minError;
  if (maxError) throw maxError;
  if (!minRow || !maxRow) return [];

  const start = minRow.year_start;
  const end = Math.min(maxRow.year_end, currentYear + 1);
  const years: number[] = [];
  for (let y = end; y >= start; y--) years.push(y);
  return years;
}

export async function listFitmentMakes(year: number): Promise<string[]> {
  await requireUser();
  const supabase = await createClient();
  const makes = new Set<string>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("fitment_vehicle")
      .select("make")
      .lte("year_start", year)
      .gte("year_end", year)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      if (row.make?.trim()) makes.add(row.make);
    }
    if (data.length < pageSize) break;
  }

  return [...makes].sort((a, b) => a.localeCompare(b));
}

export async function listFitmentModels(year: number, make: string): Promise<string[]> {
  await requireUser();
  const supabase = await createClient();
  const models = new Set<string>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("fitment_vehicle")
      .select("model")
      .ilike("make", make)
      .lte("year_start", year)
      .gte("year_end", year)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      if (row.model?.trim()) models.add(row.model);
    }
    if (data.length < pageSize) break;
  }

  return [...models].sort((a, b) => a.localeCompare(b));
}

export async function getFitmentVehicle(
  year: number,
  make: string,
  model: string
): Promise<FitmentVehicle | null> {
  const user = await requireUser();
  if (!canOrderPart(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fitment_vehicle")
    .select(
      "vehicle_id, make, model, year_start, year_end, category, spec_data, part_data"
    )
    .ilike("make", make)
    .ilike("model", model);

  if (error) throw error;

  const match = (data ?? []).find((row) =>
    rowCoversYear(row.year_start, row.year_end, year)
  );

  if (!match) return null;

  return {
    ...match,
    spec_data: (match.spec_data as Record<string, string>) ?? {},
    part_data: (match.part_data as Record<string, string>) ?? {},
  };
}

function mapCatalogHit(row: {
  part_number: string;
  brand: string | null;
  description_en: string | null;
  msrp: number | null;
  dealer_price: number | null;
  qty_cal: number | null;
  qty_lon: number | null;
}): PartsCanadaSearchHit {
  const stock =
    (row.qty_cal ?? 0) + (row.qty_lon ?? 0) > 0
      ? (row.qty_cal ?? 0) + (row.qty_lon ?? 0)
      : null;
  return {
    part_number: row.part_number,
    brand: row.brand,
    description_en: row.description_en,
    msrp: row.msrp,
    dealer_price: row.dealer_price,
    stock,
    qty_cal: row.qty_cal,
    qty_lon: row.qty_lon,
  };
}

export async function getFitmentPartsWithCatalog(
  year: number,
  make: string,
  model: string
): Promise<{
  vehicle: FitmentVehicle;
  specs: { field: string; label: string; value: string }[];
  parts: FitmentPartMatch[];
} | null> {
  const vehicle = await getFitmentVehicle(year, make, model);
  if (!vehicle) return null;

  const partEntries = extractPartNumbers(vehicle.part_data);
  const skus = collectCatalogSkus(partEntries);

  const supabase = await createClient();
  const catalogBySku = new Map<string, PartsCanadaSearchHit>();

  if (skus.length > 0) {
    const { data: catalogRows, error } = await supabase
      .from("parts_canada_catalog")
      .select("part_number, brand, description_en, msrp, dealer_price, qty_cal, qty_lon")
      .in("part_number", skus.slice(0, 100));

    if (error) throw error;

    for (const row of catalogRows ?? []) {
      const hit = mapCatalogHit(row);
      for (const variant of skuLookupVariants(row.part_number)) {
        catalogBySku.set(variant, hit);
      }
    }
  }

  const specs = Object.entries(vehicle.spec_data)
    .filter(([, v]) => String(v ?? "").trim())
    .map(([field, value]) => ({
      field,
      label: fitmentFieldLabel(field),
      value: String(value),
    }));

  for (const [field, value] of Object.entries(vehicle.part_data)) {
    if (SPEC_KEYS.has(field) && String(value ?? "").trim()) {
      if (!specs.some((s) => s.field === field)) {
        specs.push({
          field,
          label: fitmentFieldLabel(field),
          value: String(value),
        });
      }
    }
  }

  const parts: FitmentPartMatch[] = partEntries.map((entry) => {
    let catalog_hit: PartsCanadaSearchHit | null = null;
    if (entry.pcSku) {
      for (const variant of skuLookupVariants(entry.pcSku)) {
        const hit = catalogBySku.get(variant);
        if (hit) {
          catalog_hit = hit;
          break;
        }
      }
    }
    return {
      field: entry.field,
      label: fitmentFieldLabel(entry.field),
      value: entry.value,
      catalog_hit,
    };
  });

  return { vehicle, specs, parts };
}

/** Import fitment CSV rows (admin/cron). */
export async function importFitmentRows(
  rows: Record<string, string>[],
  sourcePath?: string
): Promise<{ row_count: number }> {
  const admin = createAdminClient();

  const { data: run, error: runError } = await admin
    .from("fitment_import_run")
    .insert({ status: "running", source_path: sourcePath ?? null })
    .select("import_run_id")
    .single();

  if (runError) throw runError;

  try {
    const specFields = new Set([
      "frontTireSize",
      "rearTireSize",
      "chain",
      "frontSprocket",
      "rearSprocket",
      "battery",
      "ngkPlug",
      "lithiumBattery",
      "recommendedOil",
      "forkSealKit",
    ]);

    const metaFields = new Set([
      "make",
      "model",
      "category",
      "yearStart",
      "yearEnd",
      "storeCollectionId",
    ]);

    const vehicles = rows
      .map((row) => {
        const spec_data: Record<string, string> = {};
        const part_data: Record<string, string> = {};

        for (const [key, raw] of Object.entries(row)) {
          const value = String(raw ?? "").trim();
          if (!value) continue;
          if (specFields.has(key)) spec_data[key] = value;
          else if (!metaFields.has(key)) part_data[key] = value;
        }

        return {
          make: row.make?.trim() ?? "",
          model: row.model?.trim() ?? "",
          year_start: Number(row.yearStart),
          year_end: Number(row.yearEnd),
          category: row.category?.trim() || "motorcycle",
          spec_data,
          part_data,
        };
      })
      .filter(
        (vehicle) =>
          vehicle.make &&
          vehicle.model &&
          Number.isFinite(vehicle.year_start) &&
          Number.isFinite(vehicle.year_end)
      );

    const deduped = new Map<string, (typeof vehicles)[number]>();
    for (const vehicle of vehicles) {
      const key = `${vehicle.make.toLowerCase()}|${vehicle.model.toLowerCase()}|${vehicle.year_start}|${vehicle.year_end}`;
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, vehicle);
        continue;
      }
      existing.spec_data = { ...existing.spec_data, ...vehicle.spec_data };
      existing.part_data = { ...existing.part_data, ...vehicle.part_data };
    }

    const vehicleRows = Array.from(deduped.values());

    await admin
      .from("fitment_vehicle")
      .delete()
      .neq("vehicle_id", "00000000-0000-0000-0000-000000000000");

    for (let i = 0; i < vehicleRows.length; i += BATCH) {
      const slice = vehicleRows.slice(i, i + BATCH);
      const { error } = await admin.from("fitment_vehicle").insert(slice);
      if (error) throw error;
    }

    await admin
      .from("fitment_import_run")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        row_count: vehicleRows.length,
      })
      .eq("import_run_id", run.import_run_id);

    // Keep every bike's service card in sync with the new catalogue.
    await syncAllMotorcycleServiceInfoFromFitment(admin);

    return { row_count: vehicleRows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FITMENT_IMPORT_FAILED";
    await admin
      .from("fitment_import_run")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message.slice(0, 500),
      })
      .eq("import_run_id", run.import_run_id);
    throw error;
  }
}
