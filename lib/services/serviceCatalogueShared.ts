export type Service = {
  service_id: string;
  name: string;
  category: string | null;
  standard_price: number | null;
  estimated_labour: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export const UNCATEGORISED_SERVICE_GROUP = "Other";

/** Preferred Visit details / catalogue display order. */
export const SERVICE_CATEGORY_ORDER = [
  "Oil & Fluids",
  "Filters & Ignition",
  "Electrical",
  "Brakes",
  "Tires",
  "Chain & Drive",
  "Suspension",
  "Inspection & Diagnostics",
  "Seasonal",
  "Storage",
  "Other",
] as const;

function categorySortKey(category: string): number {
  const index = SERVICE_CATEGORY_ORDER.indexOf(
    category as (typeof SERVICE_CATEGORY_ORDER)[number]
  );
  if (index >= 0) return index;
  if (category === UNCATEGORISED_SERVICE_GROUP) return SERVICE_CATEGORY_ORDER.length;
  // Unknown categories after known ones, before Other
  return SERVICE_CATEGORY_ORDER.length - 0.5;
}

/** Groups services by category in shop-floor display order. */
export function groupServicesByCategory(
  services: Service[]
): Array<{ category: string; services: Service[] }> {
  const groups = new Map<string, Service[]>();
  for (const service of services) {
    const key = service.category?.trim() || UNCATEGORISED_SERVICE_GROUP;
    const bucket = groups.get(key);
    if (bucket) bucket.push(service);
    else groups.set(key, [service]);
  }

  for (const bucket of groups.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ka = categorySortKey(a);
      const kb = categorySortKey(b);
      if (ka !== kb) return ka - kb;
      return a.localeCompare(b);
    })
    .map(([category, grouped]) => ({ category, services: grouped }));
}
