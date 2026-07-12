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

/** Groups services by category, keeping category order alphabetical with uncategorised last. */
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

  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === UNCATEGORISED_SERVICE_GROUP) return 1;
      if (b === UNCATEGORISED_SERVICE_GROUP) return -1;
      return a.localeCompare(b);
    })
    .map(([category, grouped]) => ({ category, services: grouped }));
}
