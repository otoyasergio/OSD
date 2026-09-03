import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { PhotoCategory } from "@/lib/database/types";
import { canViewClients } from "@/lib/permissions";
import {
  categoriesForGalleryGroup,
  photoMatchesGallerySearch,
  type GalleryPhotoGroup,
} from "@/lib/photos/galleryGroups";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { signStoragePaths } from "@/lib/services/photos";

export const SHOP_GALLERY_PAGE_SIZE = 60;

export type StaffGalleryPhoto = {
  photo_id: string;
  work_order_id: string;
  work_order_number: string;
  motorcycle_id: string | null;
  motorcycle_label: string;
  customer_label: string;
  category: PhotoCategory;
  category_label: string;
  notes: string | null;
  created_at: string;
  signed_url: string | null;
};

type RawGalleryPhotoRow = {
  photo_id: string;
  work_order_id: string;
  storage_path: string;
  photo_url: string | null;
  category: PhotoCategory;
  notes: string | null;
  created_at: string;
  work_order:
    | {
        work_order_id: string;
        work_order_number: string;
        location_id: string;
        motorcycle:
          | {
              motorcycle_id: string;
              year: number;
              make: string;
              model: string;
              plate_number: string | null;
            }
          | Array<{
              motorcycle_id: string;
              year: number;
              make: string;
              model: string;
              plate_number: string | null;
            }>
          | null;
        customer:
          | {
              first_name: string;
              last_name: string;
            }
          | Array<{
              first_name: string;
              last_name: string;
            }>
          | null;
      }
    | Array<{
        work_order_id: string;
        work_order_number: string;
        location_id: string;
        motorcycle:
          | {
              motorcycle_id: string;
              year: number;
              make: string;
              model: string;
              plate_number: string | null;
            }
          | Array<{
              motorcycle_id: string;
              year: number;
              make: string;
              model: string;
              plate_number: string | null;
            }>
          | null;
        customer:
          | {
              first_name: string;
              last_name: string;
            }
          | Array<{
              first_name: string;
              last_name: string;
            }>
          | null;
      }>
    | null;
};

function bikeLabel(
  bike: {
    year: number;
    make: string;
    model: string;
  } | null
): string {
  if (!bike) return "Unknown motorcycle";
  return `${bike.year} ${bike.make} ${bike.model}`;
}

function customerLabel(
  customer: { first_name: string; last_name: string } | null | undefined
): string {
  if (!customer) return "Unknown customer";
  return `${customer.first_name} ${customer.last_name}`.trim();
}

export type ListShopGalleryPhotosInput = {
  group?: GalleryPhotoGroup;
  q?: string;
  /** ISO created_at cursor — return photos older than this. */
  before?: string | null;
  limit?: number;
};

export async function listShopGalleryPhotos(
  input: ListShopGalleryPhotosInput = {}
): Promise<{ photos: StaffGalleryPhoto[]; hasMore: boolean }> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");
  if (!user.active_location_id) throw new Error("NO_LOCATION");

  const group = input.group ?? "all";
  const limit = Math.min(Math.max(input.limit ?? SHOP_GALLERY_PAGE_SIZE, 1), 120);
  const categories = categoriesForGalleryGroup(group);
  const supabase = await createClient();

  let query = supabase
    .from("intake_photo")
    .select(
      `
      photo_id,
      work_order_id,
      storage_path,
      photo_url,
      category,
      notes,
      created_at,
      work_order:work_order_id!inner (
        work_order_id,
        work_order_number,
        location_id,
        motorcycle:motorcycle_id (
          motorcycle_id,
          year,
          make,
          model,
          plate_number
        ),
        customer:customer_id (
          first_name,
          last_name
        )
      )
    `
    )
    .eq("work_order.location_id", user.active_location_id)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (categories) {
    query = query.in("category", categories);
  }
  if (input.before) {
    query = query.lt("created_at", input.before);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawGalleryPhotoRow[];
  const q = input.q?.trim() ?? "";

  const filtered = rows.flatMap((row) => {
    const wo = unwrapOne(row.work_order);
    if (!wo || wo.location_id !== user.active_location_id) return [];
    const bike = unwrapOne(wo.motorcycle);
    const customer = unwrapOne(wo.customer);
    if (
      q &&
      !photoMatchesGallerySearch(
        {
          work_order_number: wo.work_order_number,
          bike_year: bike?.year,
          bike_make: bike?.make,
          bike_model: bike?.model,
          bike_plate: bike?.plate_number,
          customer_first_name: customer?.first_name,
          customer_last_name: customer?.last_name,
        },
        q
      )
    ) {
      return [];
    }
    return [{ row, wo, bike, customer }];
  });

  const page = filtered.slice(0, limit);
  const signed = await signStoragePaths(
    supabase,
    page.map(({ row }) => row.storage_path)
  );

  const photos: StaffGalleryPhoto[] = page.map(({ row, wo, bike, customer }) => ({
    photo_id: row.photo_id,
    work_order_id: row.work_order_id,
    work_order_number: wo.work_order_number,
    motorcycle_id: bike?.motorcycle_id ?? null,
    motorcycle_label: bikeLabel(bike),
    customer_label: customerLabel(customer),
    category: row.category,
    category_label: PHOTO_CATEGORY_LABELS[row.category] ?? row.category,
    notes: row.notes,
    created_at: row.created_at,
    signed_url: signed.get(row.storage_path) ?? row.photo_url,
  }));

  return { photos, hasMore: filtered.length > limit };
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function listIntakePhotosForMotorcycle(
  motorcycleId: string
): Promise<StaffGalleryPhoto[]> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  const { data: workOrders, error: woError } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      motorcycle:motorcycle_id (
        motorcycle_id,
        year,
        make,
        model,
        plate_number
      ),
      customer:customer_id (
        first_name,
        last_name
      )
    `
    )
    .eq("motorcycle_id", motorcycleId)
    .not("status", "eq", "cancelled");

  if (woError) throw woError;

  type BikeRel = {
    motorcycle_id: string;
    year: number;
    make: string;
    model: string;
    plate_number: string | null;
  };
  type CustomerRel = { first_name: string; last_name: string };

  const woRows = (
    (workOrders ?? []) as unknown as Array<{
      work_order_id: string;
      work_order_number: string;
      motorcycle: BikeRel | BikeRel[] | null;
      customer: CustomerRel | CustomerRel[] | null;
    }>
  ).map((row) => ({
    work_order_id: row.work_order_id,
    work_order_number: row.work_order_number,
    motorcycle: unwrapOne(row.motorcycle),
    customer: unwrapOne(row.customer),
  }));

  if (woRows.length === 0) return [];

  const byId = new Map(woRows.map((row) => [row.work_order_id, row]));
  const workOrderIds = [...byId.keys()];

  const { data: photoRows, error: photoError } = await supabase
    .from("intake_photo")
    .select(
      "photo_id, work_order_id, storage_path, photo_url, category, notes, created_at"
    )
    .in("work_order_id", workOrderIds)
    .order("created_at", { ascending: false });

  if (photoError) throw photoError;

  const rows = photoRows ?? [];
  const signed = await signStoragePaths(
    supabase,
    rows.map((row) => row.storage_path as string)
  );

  return rows.map((row) => {
    const wo = byId.get(row.work_order_id as string)!;
    const category = row.category as PhotoCategory;
    return {
      photo_id: row.photo_id as string,
      work_order_id: row.work_order_id as string,
      work_order_number: wo.work_order_number,
      motorcycle_id: wo.motorcycle?.motorcycle_id ?? motorcycleId,
      motorcycle_label: bikeLabel(wo.motorcycle),
      customer_label: customerLabel(wo.customer),
      category,
      category_label: PHOTO_CATEGORY_LABELS[category] ?? category,
      notes: (row.notes as string | null) ?? null,
      created_at: row.created_at as string,
      signed_url:
        signed.get(row.storage_path as string) ?? (row.photo_url as string | null),
    };
  });
}
