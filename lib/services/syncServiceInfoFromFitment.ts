import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/database/supabase-admin";
import {
  buildServiceInfoFromFitmentRows,
  mergeServiceInfoFill,
  type FitmentPayload,
  type ServiceInfoFitmentFields,
} from "@/lib/fitment/serviceInfoFromFitment";

type SyncClient = SupabaseClient;

type MotorcycleYmm = {
  motorcycle_id: string;
  year: number;
  make: string;
  model: string;
};

type ServiceInfoRow = ServiceInfoFitmentFields & {
  motorcycle_id: string;
  oil_capacity: string | null;
};

const SERVICE_INFO_SELECT =
  "motorcycle_id, oil_filter, oil_type, oil_capacity, air_filter, spark_plugs, front_brake_pads, rear_brake_pads, front_tire_size, rear_tire_size, chain, battery";

export type SyncServiceInfoResult = {
  scanned: number;
  updated: number;
  filled_fields: number;
  missing_service_rows_created: number;
};

const FITMENT_PAGE_SIZE = 1000;

async function loadFitmentRows(client: SyncClient): Promise<FitmentPayload[]> {
  const rows: FitmentPayload[] = [];
  for (let from = 0; ; from += FITMENT_PAGE_SIZE) {
    const to = from + FITMENT_PAGE_SIZE - 1;
    const { data, error } = await client
      .from("fitment_vehicle")
      .select("make, model, year_start, year_end, spec_data, part_data")
      .order("vehicle_id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    const page = data ?? [];
    for (const row of page) {
      rows.push({
        make: row.make as string,
        model: row.model as string,
        year_start: row.year_start as number,
        year_end: row.year_end as number,
        spec_data: (row.spec_data as Record<string, string>) ?? {},
        part_data: (row.part_data as Record<string, string>) ?? {},
      });
    }
    if (page.length < FITMENT_PAGE_SIZE) break;
  }
  return rows;
}

function fitmentRowsForMake(rows: FitmentPayload[], make: string): FitmentPayload[] {
  const key = make.trim().toLowerCase();
  return rows.filter((row) => row.make.trim().toLowerCase() === key);
}

/** Normalize staff make/model before matching (trailing spaces, etc.). */
function normalizeMotorcycleYmm(motorcycle: MotorcycleYmm): MotorcycleYmm {
  return {
    ...motorcycle,
    make: motorcycle.make.trim(),
    model: motorcycle.model.trim(),
  };
}

export async function applyFitmentFillToServiceInfo(
  client: SyncClient,
  motorcycle: MotorcycleYmm,
  existing: ServiceInfoRow,
  fitmentRows: FitmentPayload[],
  options: { refreshFitmentValues?: boolean } = {}
): Promise<number> {
  const ymm = normalizeMotorcycleYmm(motorcycle);
  const mapped = buildServiceInfoFromFitmentRows(
    fitmentRowsForMake(fitmentRows, ymm.make),
    ymm.year,
    ymm.make,
    ymm.model
  );
  if (!mapped) return 0;

  const { next, filledCount } = mergeServiceInfoFill(existing, mapped, options);
  if (filledCount === 0) return 0;

  const { error } = await client
    .from("motorcycle_service_information")
    .update({
      oil_filter: next.oil_filter,
      oil_type: next.oil_type,
      oil_capacity: next.oil_capacity ?? existing.oil_capacity,
      air_filter: next.air_filter,
      spark_plugs: next.spark_plugs,
      front_brake_pads: next.front_brake_pads,
      rear_brake_pads: next.rear_brake_pads,
      front_tire_size: next.front_tire_size,
      rear_tire_size: next.rear_tire_size,
      chain: next.chain,
      battery: next.battery,
      last_updated: new Date().toISOString(),
    })
    .eq("motorcycle_id", motorcycle.motorcycle_id);

  if (error) throw error;
  return filledCount;
}

/**
 * Fill / refresh service-info part fields for every motorcycle from fitment_vehicle.
 * Safe for staff edits: only blanks + prior fitment-owned values are written.
 */
export async function syncAllMotorcycleServiceInfoFromFitment(
  client: SyncClient = createAdminClient()
): Promise<SyncServiceInfoResult> {
  const fitmentRows = await loadFitmentRows(client);

  const { data: motorcycles, error: bikeError } = await client
    .from("motorcycle")
    .select("motorcycle_id, year, make, model");
  if (bikeError) throw bikeError;

  const bikes = (motorcycles ?? []) as MotorcycleYmm[];
  if (bikes.length === 0) {
    return {
      scanned: 0,
      updated: 0,
      filled_fields: 0,
      missing_service_rows_created: 0,
    };
  }

  const { data: infoRows, error: infoError } = await client
    .from("motorcycle_service_information")
    .select(SERVICE_INFO_SELECT);
  if (infoError) throw infoError;

  const infoByBike = new Map(
    ((infoRows ?? []) as ServiceInfoRow[]).map((row) => [row.motorcycle_id, row])
  );

  let missingCreated = 0;
  for (const bike of bikes) {
    if (infoByBike.has(bike.motorcycle_id)) continue;
    const { error } = await client
      .from("motorcycle_service_information")
      .insert({ motorcycle_id: bike.motorcycle_id });
    if (error) throw error;
    infoByBike.set(bike.motorcycle_id, {
      motorcycle_id: bike.motorcycle_id,
      oil_filter: null,
      oil_type: null,
      oil_capacity: null,
      air_filter: null,
      spark_plugs: null,
      front_brake_pads: null,
      rear_brake_pads: null,
      front_tire_size: null,
      rear_tire_size: null,
      chain: null,
      battery: null,
    });
    missingCreated += 1;
  }

  let updated = 0;
  let filledFields = 0;

  for (const bike of bikes) {
    const existing = infoByBike.get(bike.motorcycle_id);
    if (!existing) continue;
    const filled = await applyFitmentFillToServiceInfo(
      client,
      bike,
      existing,
      fitmentRows,
      { refreshFitmentValues: true }
    );
    if (filled > 0) {
      updated += 1;
      filledFields += filled;
    }
  }

  return {
    scanned: bikes.length,
    updated,
    filled_fields: filledFields,
    missing_service_rows_created: missingCreated,
  };
}
