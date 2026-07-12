import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import {
  pickPrimaryIntakePhoto,
  resolvePrimaryPhotoUrls,
  type IntakePhotoRef,
} from "@/lib/services/photos";
export type GarageWorkOrderPhotos = {
  work_order_id: string;
  date_created: string;
  intake_photo: IntakePhotoRef[];
};

export type GarageBikeInput = {
  motorcycle_id: string;
  year: number;
  make: string;
  model: string;
  colour: string | null;
  vin: string | null;
};

export type GarageBikeCard = {
  motorcycle_id: string;
  year: number;
  make: string;
  model: string;
  colour: string | null;
  vin: string | null;
  missing_vin: boolean;
  primary_photo_url: string | null;
  href: string;
};

/**
 * Prefer the newest work order that has intake photos; within that visit,
 * front is preferred via pickPrimaryIntakePhoto.
 */
export function pickPrimaryPhotoForMotorcycle(
  workOrders: GarageWorkOrderPhotos[]
): IntakePhotoRef | null {
  const ordered = [...workOrders].sort((a, b) =>
    b.date_created.localeCompare(a.date_created)
  );

  for (const wo of ordered) {
    const primary = pickPrimaryIntakePhoto(wo.intake_photo ?? []);
    if (primary) return primary;
  }

  return null;
}

export function toGarageBikeCards(
  bikes: GarageBikeInput[],
  photoUrlsByMotorcycleId: Map<string, string | null>
): GarageBikeCard[] {
  return bikes.map((bike) => ({
    motorcycle_id: bike.motorcycle_id,
    year: bike.year,
    make: bike.make,
    model: bike.model,
    colour: bike.colour,
    vin: bike.vin,
    missing_vin: !bike.vin,
    primary_photo_url: photoUrlsByMotorcycleId.get(bike.motorcycle_id) ?? null,
    href: `/motorcycles/${bike.motorcycle_id}`,
  }));
}

type RawWorkOrderRow = {
  work_order_id: string;
  motorcycle_id: string;
  date_created: string;
  intake_photo: IntakePhotoRef[] | null;
};

/**
 * Motorcycles for a customer with a signed primary intake photo when one
 * exists on a prior work order (most recent visit with photos, front preferred).
 */
export async function listGarageForCustomer(
  customerId: string
): Promise<GarageBikeCard[]> {
  await requireUser();
  const supabase = await createClient();

  const { data: motorcycleRows, error: motorcycleError } = await supabase
    .from("motorcycle")
    .select(
      "motorcycle_id, year, make, model, colour, vin"
    )
    .eq("customer_id", customerId)
    .order("year", { ascending: false });

  if (motorcycleError) throw motorcycleError;

  const bikes = (motorcycleRows ?? []) as GarageBikeInput[];
  if (bikes.length === 0) return [];

  const motorcycleIds = bikes.map((bike) => bike.motorcycle_id);

  const { data: workOrderRows, error: workOrderError } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      motorcycle_id,
      date_created,
      intake_photo ( photo_id, storage_path, photo_url, category, created_at )
    `
    )
    .in("motorcycle_id", motorcycleIds)
    .order("date_created", { ascending: false });

  if (workOrderError) throw workOrderError;

  const byMotorcycle = new Map<string, GarageWorkOrderPhotos[]>();
  for (const row of (workOrderRows ?? []) as unknown as RawWorkOrderRow[]) {
    const list = byMotorcycle.get(row.motorcycle_id) ?? [];
    list.push({
      work_order_id: row.work_order_id,
      date_created: row.date_created,
      intake_photo: row.intake_photo ?? [],
    });
    byMotorcycle.set(row.motorcycle_id, list);
  }

  // Resolve one primary photo URL per motorcycle via a synthetic work-order map
  // so we reuse the same signing helper as dashboard / filed cards.
  const photosBySyntheticWo = new Map<string, IntakePhotoRef[]>();
  const motorcycleBySyntheticWo = new Map<string, string>();

  for (const bike of bikes) {
    const primary = pickPrimaryPhotoForMotorcycle(
      byMotorcycle.get(bike.motorcycle_id) ?? []
    );
    if (!primary) continue;
    const syntheticId = `garage:${bike.motorcycle_id}`;
    photosBySyntheticWo.set(syntheticId, [primary]);
    motorcycleBySyntheticWo.set(syntheticId, bike.motorcycle_id);
  }

  const signedBySynthetic = await resolvePrimaryPhotoUrls(
    supabase,
    photosBySyntheticWo
  );

  const photoUrlsByMotorcycleId = new Map<string, string | null>();
  for (const [syntheticId, motorcycleId] of motorcycleBySyntheticWo) {
    photoUrlsByMotorcycleId.set(
      motorcycleId,
      signedBySynthetic.get(syntheticId) ?? null
    );
  }

  return toGarageBikeCards(bikes, photoUrlsByMotorcycleId);
}
