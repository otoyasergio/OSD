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

export type ServicePricingMode = "itemized" | "fixed_package" | "no_charge";

export const SERVICE_PRICING_MODE_OPTIONS: Array<{
  value: ServicePricingMode;
  label: string;
}> = [
  { value: "fixed_package", label: "Fixed package (uses standard price)" },
  { value: "itemized", label: "Itemized labour + parts" },
  { value: "no_charge", label: "No charge" },
];

/** Fields captured by a catalogue version snapshot (Workflow V2). */
export type ServiceVersionFields = {
  name: string;
  category: string | null;
  standard_price: number | null;
  estimated_labour: number | null;
  pricing_mode?: ServicePricingMode | null;
};

/** Next version number: previous max + 1 (create starts at 1). */
export function nextServiceVersionNo(previousMax: number | null | undefined): number {
  if (previousMax == null || !Number.isFinite(previousMax) || previousMax < 0) return 1;
  return Math.floor(previousMax) + 1;
}

export type ServiceVersionSnapshot = {
  name_snapshot: string;
  category_snapshot: string | null;
  pricing_mode: ServicePricingMode;
  fixed_package_price_cents: number | null;
  default_labor_minutes: number | null;
};

/**
 * A new catalogue version is only written when a snapshot-relevant field
 * actually changed; re-saving identical values must not spawn noise
 * versions. Creation (no previous version row) always versions.
 */
export function shouldWriteServiceVersion(
  previous: ServiceVersionSnapshot | null,
  next: ServiceVersionSnapshot
): boolean {
  if (!previous) return true;
  return (
    previous.name_snapshot !== next.name_snapshot ||
    (previous.category_snapshot ?? null) !== (next.category_snapshot ?? null) ||
    previous.pricing_mode !== next.pricing_mode ||
    (previous.fixed_package_price_cents ?? null) !==
      (next.fixed_package_price_cents ?? null) ||
    (previous.default_labor_minutes ?? null) !== (next.default_labor_minutes ?? null)
  );
}

/**
 * Legacy dollars/hours → V2 snapshot units: standard price becomes integer
 * package cents, estimated labour hours become whole minutes.
 */
export function buildServiceVersionSnapshot(
  fields: ServiceVersionFields
): ServiceVersionSnapshot {
  return {
    name_snapshot: fields.name,
    category_snapshot: fields.category ?? null,
    pricing_mode: fields.pricing_mode ?? "fixed_package",
    fixed_package_price_cents:
      fields.standard_price == null ? null : Math.round(fields.standard_price * 100),
    default_labor_minutes:
      fields.estimated_labour == null ? null : Math.round(fields.estimated_labour * 60),
  };
}

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

function isDiagnosticService(service: Service): boolean {
  const name = service.name.trim().toLowerCase();
  return name === "diagnostic" || name === "diagnostics";
}

/** Intake keeps the catch-all diagnostic choice immediately visible. */
export function groupIntakeServicesByCategory(
  services: Service[]
): Array<{ category: string; services: Service[] }> {
  return groupServicesByCategory(services)
    .map((group) => ({
      ...group,
      services: [...group.services].sort((a, b) => {
        const aPinned = isDiagnosticService(a);
        const bPinned = isDiagnosticService(b);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    }))
    .sort((a, b) => {
      const aPinned = a.services.some(isDiagnosticService);
      const bPinned = b.services.some(isDiagnosticService);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return 0;
    });
}

/** Filters intake services by name while keeping current selections visible. */
export function filterIntakeServiceGroups(
  groups: Array<{ category: string; services: Service[] }>,
  query: string,
  selectedServiceIds: string[]
): Array<{ category: string; services: Service[] }> {
  const term = query.trim().toLocaleLowerCase("en-CA");
  if (!term) return groups;

  const selected = new Set(selectedServiceIds);
  return groups
    .map((group) => ({
      ...group,
      services: group.services.filter(
        (service) =>
          selected.has(service.service_id) ||
          service.name.toLocaleLowerCase("en-CA").includes(term)
      ),
    }))
    .filter((group) => group.services.length > 0);
}
