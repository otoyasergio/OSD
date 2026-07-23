import { createClient } from "@/lib/database/supabase-server";
import type { WorkOrderStatus } from "@/lib/database/types";
import { searchCustomers } from "@/lib/services/customers";
import { searchMotorcycles } from "@/lib/services/motorcycles";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";

export type SearchResult =
  | { type: "work_order"; id: string; label: string; href: string; meta: string }
  | { type: "customer"; id: string; label: string; href: string; meta: string }
  | { type: "motorcycle"; id: string; label: string; href: string; meta: string };

export type SearchAllOptions = {
  locationId: string;
  limit?: number;
  /** When false, skip customer/motorcycle CRM hits and omit customer PII from WO meta. */
  includeClients?: boolean;
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

    if (result.type === "work_order" && isWoNumberPrefixMatch(query, result.label)) {
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

type SearchWoRow = {
  work_order_id: string;
  work_order_number: string;
  external_invoice_number: string | null;
  status: WorkOrderStatus;
  customer: {
    first_name: string;
    last_name: string;
  } | null;
  motorcycle: {
    year: number;
    make: string;
    model: string;
    vin: string | null;
  } | null;
};

const WO_SEARCH_SELECT = `
  work_order_id,
  work_order_number,
  external_invoice_number,
  status,
  customer:customer_id ( first_name, last_name ),
  motorcycle:motorcycle_id ( year, make, model, vin )
`;

function rowMatchesQuery(row: SearchWoRow, query: string): boolean {
  if (isWoNumberPrefixMatch(query, row.work_order_number)) return true;
  const q = normalizeQuery(query);
  const customer = row.customer;
  const bike = row.motorcycle;
  const haystack = [
    row.work_order_number,
    row.external_invoice_number,
    customer?.first_name,
    customer?.last_name,
    bike?.make,
    bike?.model,
    bike?.vin,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * Lean WO typeahead query — never loads the full dashboard board graph.
 * Matches WO/invoice via SQL ilike, plus customer/bike/VIN via a small recent window.
 */
async function searchWorkOrders(
  query: string,
  locationId: string,
  limit: number
): Promise<SearchWoRow[]> {
  const supabase = await createClient();
  const cleaned = query.replace(/[%_]/g, "").trim();
  if (!cleaned) return [];
  const pattern = `%${cleaned}%`;
  const fetchLimit = Math.min(Math.max(limit * 4, 24), 60);

  const [numberResult, recentResult] = await Promise.all([
    supabase
      .from("work_order")
      .select(WO_SEARCH_SELECT)
      .eq("location_id", locationId)
      .or(`work_order_number.ilike.${pattern},external_invoice_number.ilike.${pattern}`)
      .order("date_created", { ascending: false })
      .limit(fetchLimit),
    supabase
      .from("work_order")
      .select(WO_SEARCH_SELECT)
      .eq("location_id", locationId)
      .order("date_created", { ascending: false })
      .limit(80),
  ]);

  if (numberResult.error) throw numberResult.error;
  if (recentResult.error) throw recentResult.error;

  const byId = new Map<string, SearchWoRow>();
  for (const row of (numberResult.data ?? []) as unknown as SearchWoRow[]) {
    byId.set(row.work_order_id, row);
  }
  for (const row of (recentResult.data ?? []) as unknown as SearchWoRow[]) {
    if (byId.has(row.work_order_id)) continue;
    if (rowMatchesQuery(row, query)) {
      byId.set(row.work_order_id, row);
    }
  }

  return [...byId.values()];
}

/**
 * Unified typeahead search across work orders (active location), customers, and motorcycles.
 */
export async function searchAll(
  query: string,
  options: SearchAllOptions
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  const limit = options.limit ?? 8;
  if (!trimmed || !options.locationId) return [];

  const includeClients = options.includeClients !== false;

  const [customers, motorcycles, workOrders] = await Promise.all([
    includeClients ? searchCustomers(trimmed) : Promise.resolve([]),
    includeClients ? searchMotorcycles(trimmed) : Promise.resolve([]),
    searchWorkOrders(trimmed, options.locationId, limit),
  ]);

  const results: SearchResult[] = workOrders.map((row) => {
    const customer = row.customer;
    const bike = row.motorcycle
      ? `${row.motorcycle.year} ${row.motorcycle.make} ${row.motorcycle.model}`
      : null;
    const customerName =
      includeClients && customer
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
  });

  if (includeClients) {
    results.push(
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
          meta:
            [owner, bike.plate_number ? `Plate ${bike.plate_number}` : null, bike.vin]
              .filter(Boolean)
              .join(" · ") || "Motorcycle",
        };
      })
    );
  }

  return rankSearchResults(trimmed, results).slice(0, limit);
}
