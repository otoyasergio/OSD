import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { PhotoCategory } from "@/lib/database/types";
import { resolvePrimaryPhotoUrls, type IntakePhotoRef } from "@/lib/services/photos";

export type ReadyForPickupItem = {
  work_order_id: string;
  work_order_number: string;
  motorcycle_label: string;
  /** When the bike became ready; falls back to updated_at if stamp missing. */
  ready_since: string;
  /** True when ready_for_pickup_at was null and we used updated_at. */
  ready_since_inferred: boolean;
  primary_photo_url: string | null;
  overview_href: string;
};

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

type ReadyRow = {
  work_order_id: string;
  work_order_number: string;
  ready_for_pickup_at: string | null;
  updated_at: string;
  motorcycle: NestedMotorcycle | NestedMotorcycle[];
  intake_photo: NestedPhoto[] | null;
};

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Location-scoped work orders currently waiting for customer pickup.
 * Shown on the tech floor for shop awareness (no customer PII).
 */
export async function listReadyForPickup(): Promise<ReadyForPickupItem[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;

  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      ready_for_pickup_at,
      updated_at,
      motorcycle:motorcycle_id ( year, make, model ),
      intake_photo ( photo_id, storage_path, photo_url, category, created_at )
    `
    )
    .eq("location_id", locationId)
    .eq("status", "ready_for_pickup")
    .order("ready_for_pickup_at", { ascending: true, nullsFirst: false });

  if (error) throw error;

  const rows = (data ?? []) as ReadyRow[];
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
    const readyAt = row.ready_for_pickup_at;
    return {
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      motorcycle_label: motorcycle
        ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
        : "—",
      ready_since: readyAt ?? row.updated_at,
      ready_since_inferred: !readyAt,
      primary_photo_url: urls.get(row.work_order_id) ?? null,
      overview_href: `/work_orders/${row.work_order_id}`,
    };
  });
}
