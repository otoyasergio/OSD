import { searchCustomers } from "@/lib/services/customers";
import { getDashboardData } from "@/lib/services/dashboard";
import { searchMotorcycles } from "@/lib/services/motorcycles";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";

export type SearchResult =
  | { type: "work_order"; id: string; label: string; href: string; meta: string }
  | { type: "customer"; id: string; label: string; href: string; meta: string }
  | { type: "motorcycle"; id: string; label: string; href: string; meta: string };

export type SearchAllOptions = {
  locationId: string;
  limit?: number;
};

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Collapse optional hyphen after WO so `WO1001` and `WO-1001` compare equally. */
function normalizeWoToken(value: string): string {
  return value.trim().toLowerCase().replace(/^wo-?/, "wo");
}

function isWoNumberPrefixMatch(query: string, workOrderNumber: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return false;
  const label = workOrderNumber.toLowerCase();
  if (label.startsWith(q)) return true;
  return normalizeWoToken(workOrderNumber).startsWith(normalizeWoToken(query));
}

function isExactCustomerName(query: string, label: string): boolean {
  return normalizeQuery(label) === normalizeQuery(query);
}

/**
 * Rank mixed search hits: WO number prefix matches first, then exact customer
 * name matches, then remaining partial matches (label prefix → label contains → meta).
 */
export function rankSearchResults(
  query: string,
  results: SearchResult[]
): SearchResult[] {
  const q = normalizeQuery(query);

  function score(result: SearchResult): number {
    const label = result.label.toLowerCase();
    const meta = result.meta.toLowerCase();

    if (
      result.type === "work_order" &&
      isWoNumberPrefixMatch(query, result.label)
    ) {
      return 0;
    }

    if (result.type === "customer" && isExactCustomerName(query, result.label)) {
      return 1;
    }

    if (q && label.startsWith(q)) return 2;
    if (q && label.includes(q)) return 3;
    if (q && meta.includes(q)) return 4;
    return 5;
  }

  return [...results].sort((a, b) => {
    const scoreDiff = score(a) - score(b);
    if (scoreDiff !== 0) return scoreDiff;
    if (a.type !== b.type) {
      const typeOrder = { work_order: 0, customer: 1, motorcycle: 2 } as const;
      return typeOrder[a.type] - typeOrder[b.type];
    }
    return a.label.localeCompare(b.label);
  });
}

function customerMeta(phone: string | null, email: string | null): string {
  return phone?.trim() || email?.trim() || "Customer";
}

/**
 * Unified typeahead search across work orders (active location), customers, and motorcycles.
 * `locationId` documents the WO scope; dashboard query uses the session active location
 * (callers should pass `user.active_location_id`).
 */
export async function searchAll(
  query: string,
  options: SearchAllOptions
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  const limit = options.limit ?? 8;
  if (!trimmed || !options.locationId) return [];

  const [customers, motorcycles, dashboard] = await Promise.all([
    searchCustomers(trimmed),
    searchMotorcycles(trimmed),
    getDashboardData({ q: trimmed }),
  ]);

  const results: SearchResult[] = [
    ...dashboard.rows.map((row) => {
      const customer = row.motorcycle?.customer;
      const bike = row.motorcycle
        ? `${row.motorcycle.year} ${row.motorcycle.make} ${row.motorcycle.model}`
        : null;
      const customerName = customer
        ? `${customer.first_name} ${customer.last_name}`.trim()
        : null;
      const statusLabel = WORK_ORDER_STATUS_LABELS[row.status] ?? row.status;
      const metaParts = [customerName, bike, statusLabel].filter(Boolean);

      return {
        type: "work_order" as const,
        id: row.work_order_id,
        label: row.work_order_number,
        href: `/work_orders/${row.work_order_id}`,
        meta: metaParts.join(" · "),
      };
    }),
    ...customers.map((customer) => ({
      type: "customer" as const,
      id: customer.customer_id,
      label: `${customer.first_name} ${customer.last_name}`.trim(),
      href: `/customers/${customer.customer_id}`,
      meta: customerMeta(customer.phone, customer.email),
    })),
    ...motorcycles.map((bike) => {
      const owner = bike.customer
        ? `${bike.customer.first_name} ${bike.customer.last_name}`.trim()
        : null;
      return {
        type: "motorcycle" as const,
        id: bike.motorcycle_id,
        label: `${bike.year} ${bike.make} ${bike.model}`,
        href: `/motorcycles/${bike.motorcycle_id}`,
        meta: owner || bike.vin || "Motorcycle",
      };
    }),
  ];

  return rankSearchResults(trimmed, results).slice(0, limit);
}
