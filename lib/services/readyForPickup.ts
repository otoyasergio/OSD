import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { PhotoCategory, WorkOrderStatus } from "@/lib/database/types";
import { resolvePrimaryPhotoUrls, type IntakePhotoRef } from "@/lib/services/photos";

/** Bike waiting in a shop-floor stage queue (pickup, safety, etc.). */
export type WaitingStageBike = {
  work_order_id: string;
  work_order_number: string;
  motorcycle_label: string;
  /** When the bike entered this waiting stage; may fall back to updated_at. */
  ready_since: string;
  /** True when the preferred stamp was null and we used updated_at. */
  ready_since_inferred: boolean;
  primary_photo_url: string | null;
  overview_href: string;
};

/** @deprecated Prefer WaitingStageBike — kept for existing call sites. */
export type ReadyForPickupItem = WaitingStageBike;

type NestedMotorcycle = {
  year: number;
  make: string;
  model: string;
} | null;

type NestedPhoto = {
  photo_id: string;
  storage_path: string;
  photo_url: string | null;
  category: PhotoCategory;
  created_at: string;
};

type StageRow = {
  work_order_id: string;
  work_order_number: string;
  ready_for_pickup_at: string | null;
  quality_checked_at: string | null;
  updated_at: string;
  motorcycle: NestedMotorcycle | NestedMotorcycle[];
  intake_photo: NestedPhoto[] | null;
};

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function listWaitingStageBikes(input: {
  status: WorkOrderStatus;
  since: (row: StageRow) => { at: string | null; inferredFallback: string };
  orderColumn: "ready_for_pickup_at" | "quality_checked_at" | "updated_at";
  /** Defaults to work-order overview. */
  hrefFor?: (workOrderId: string) => string;
}): Promise<WaitingStageBike[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;
  const hrefFor = input.hrefFor ?? ((id: string) => `/work_orders/${id}`);

  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      ready_for_pickup_at,
      quality_checked_at,
      updated_at,
      motorcycle:motorcycle_id ( year, make, model ),
      intake_photo ( photo_id, storage_path, photo_url, category, created_at )
    `
    )
    .eq("location_id", locationId)
    .eq("status", input.status)
    .order(input.orderColumn, { ascending: true, nullsFirst: false });

  if (error) throw error;

  const rows = (data ?? []) as StageRow[];
  const photoMap = new Map<string, IntakePhotoRef[]>();
  for (const row of rows) {
    photoMap.set(
      row.work_order_id,
      (row.intake_photo ?? []).map((p) => ({
        photo_id: p.photo_id,
        storage_path: p.storage_path,
        photo_url: p.photo_url,
        category: p.category,
        created_at: p.created_at,
      }))
    );
  }

  const urls = await resolvePrimaryPhotoUrls(supabase, photoMap);

  return rows.map((row) => {
    const motorcycle = asOne(row.motorcycle);
    const { at, inferredFallback } = input.since(row);
    return {
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      motorcycle_label: motorcycle
        ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
        : "—",
      ready_since: at ?? inferredFallback,
      ready_since_inferred: !at,
      primary_photo_url: urls.get(row.work_order_id) ?? null,
      overview_href: hrefFor(row.work_order_id),
    };
  });
}

/**
 * Location-scoped work orders currently waiting for customer pickup.
 * Primary surface: Control Center (below tech columns). Also shown on the
 * tech floor for shop awareness (no customer PII).
 */
export async function listReadyForPickup(): Promise<WaitingStageBike[]> {
  return listWaitingStageBikes({
    status: "ready_for_pickup",
    orderColumn: "ready_for_pickup_at",
    since: (row) => ({
      at: row.ready_for_pickup_at,
      inferredFallback: row.updated_at,
    }),
  });
}

/**
 * Location-scoped work orders in `waiting_for_parts`.
 * Control Center stack: under tech columns, above QC.
 * Links open the work-order Parts tab so staff see what is on order.
 * Wait timer uses updated_at (no dedicated parts-entered stamp).
 */
export async function listWaitingForParts(): Promise<WaitingStageBike[]> {
  return listWaitingStageBikes({
    status: "waiting_for_parts",
    orderColumn: "updated_at",
    since: (row) => ({
      at: null,
      inferredFallback: row.updated_at,
    }),
    hrefFor: (workOrderId) => `/work_orders/${workOrderId}?tab=parts`,
  });
}

/**
 * Location-scoped work orders in `quality_check` awaiting QC.
 * Control Center stack: under tech columns, above safety inspection.
 * Wait timer uses updated_at (no dedicated QC-entered stamp).
 */
export async function listReadyForQc(): Promise<WaitingStageBike[]> {
  return listWaitingStageBikes({
    status: "quality_check",
    orderColumn: "updated_at",
    since: (row) => ({
      at: null,
      inferredFallback: row.updated_at,
    }),
  });
}

/**
 * Location-scoped work orders in `safety_check` awaiting a safety inspection.
 * Shown on Control Center under the technician columns (above ready-for-pickup).
 * Wait timer prefers quality_checked_at (typical entry into the safety queue).
 */
export async function listReadyForSafetyInspection(): Promise<WaitingStageBike[]> {
  return listWaitingStageBikes({
    status: "safety_check",
    orderColumn: "quality_checked_at",
    since: (row) => ({
      at: row.quality_checked_at,
      inferredFallback: row.updated_at,
    }),
  });
}
