import type { PhotoCategory } from "@/lib/database/types";

/** Shop gallery / bike-profile filter buckets. */
export type GalleryPhotoGroup = "all" | "intake" | "inspection" | "after";

const INTAKE_CATEGORIES = new Set<PhotoCategory>([
  "front",
  "rear",
  "left_side",
  "right_side",
  "odometer",
  "vin",
  "damage",
  "accessories",
  "fuel_level",
  "other",
]);

const INSPECTION_CATEGORIES = new Set<PhotoCategory>([
  "inspection_tires",
  "inspection_brakes",
  "inspection_forks",
  "inspection_item",
]);

const AFTER_CATEGORIES = new Set<PhotoCategory>(["job_proof", "job_work"]);

export function galleryGroupForCategory(
  category: string
): Exclude<GalleryPhotoGroup, "all"> {
  if (INSPECTION_CATEGORIES.has(category as PhotoCategory)) return "inspection";
  if (AFTER_CATEGORIES.has(category as PhotoCategory)) return "after";
  if (INTAKE_CATEGORIES.has(category as PhotoCategory)) return "intake";
  return "intake";
}

export function categoriesForGalleryGroup(
  group: GalleryPhotoGroup
): PhotoCategory[] | null {
  if (group === "all") return null;
  if (group === "intake") return [...INTAKE_CATEGORIES];
  if (group === "inspection") return [...INSPECTION_CATEGORIES];
  return [...AFTER_CATEGORIES];
}

export function photoMatchesGalleryGroup(
  category: string,
  group: GalleryPhotoGroup
): boolean {
  if (group === "all") return true;
  return galleryGroupForCategory(category) === group;
}

export function photoMatchesGallerySearch(
  fields: {
    work_order_number: string;
    bike_year?: number | null;
    bike_make?: string | null;
    bike_model?: string | null;
    bike_plate?: string | null;
    customer_first_name?: string | null;
    customer_last_name?: string | null;
  },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    fields.work_order_number,
    fields.bike_year != null ? String(fields.bike_year) : null,
    fields.bike_make,
    fields.bike_model,
    fields.bike_plate,
    fields.customer_first_name,
    fields.customer_last_name,
    [fields.customer_first_name, fields.customer_last_name].filter(Boolean).join(" "),
    [fields.bike_year, fields.bike_make, fields.bike_model].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return haystack.some((value) => value.includes(q));
}
