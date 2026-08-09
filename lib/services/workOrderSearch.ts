import type { DbClient } from "@/lib/database/types";
import { buildCustomerSearchOrFilter, escapeSearchTerm } from "@/lib/services/customers";
import { buildMotorcycleSearchOrFilter } from "@/lib/services/motorcycles";

export type WorkOrderSearchFields = {
  work_order_number: string;
  external_invoice_number?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_phone?: string | null;
  bike_year?: number | null;
  bike_make?: string | null;
  bike_model?: string | null;
  bike_vin?: string | null;
};

/** Collapse optional hyphen after WO so `WO1001` and `WO-1001` compare equally. */
export function normalizeWoToken(value: string): string {
  return value.trim().toLowerCase().replace(/^wo-?/, "wo");
}

export function isWoNumberPrefixMatch(query: string, workOrderNumber: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const label = workOrderNumber.toLowerCase();
  if (label.startsWith(q)) return true;
  return normalizeWoToken(workOrderNumber).startsWith(normalizeWoToken(query));
}

/**
 * In-memory WO match used by filed archive and any client-side filter.
 * Empty query matches everything. WO numbers treat `WO1001` ≈ `WO-1001`.
 */
export function matchesWorkOrderSearch(
  fields: WorkOrderSearchFields,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  if (fields.work_order_number) {
    const wo = fields.work_order_number.toLowerCase();
    if (
      wo.includes(q) ||
      normalizeWoToken(fields.work_order_number).includes(normalizeWoToken(query))
    ) {
      return true;
    }
  }

  const haystack = [
    fields.external_invoice_number,
    fields.customer_first_name,
    fields.customer_last_name,
    fields.customer_phone,
    fields.bike_year != null ? String(fields.bike_year) : null,
    fields.bike_make,
    fields.bike_model,
    fields.bike_vin,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

type WoSearchRow = {
  work_order_id: string;
  date_created?: string | null;
};

function mergeByIdNewestFirst<T extends WoSearchRow>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (!byId.has(row.work_order_id)) {
      byId.set(row.work_order_id, row);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const aKey = a.date_created ?? "";
    const bKey = b.date_created ?? "";
    return bKey.localeCompare(aKey);
  });
}

async function findMatchingCustomerIds(
  supabase: DbClient,
  term: string,
  limit: number
): Promise<string[]> {
  const cleaned = escapeSearchTerm(term);
  if (!cleaned) return [];

  const { data, error } = await supabase
    .from("customer")
    .select("customer_id")
    .or(buildCustomerSearchOrFilter(term))
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row: { customer_id: string }) => row.customer_id);
}

async function findMatchingMotorcycleIds(
  supabase: DbClient,
  term: string,
  limit: number
): Promise<string[]> {
  const cleaned = escapeSearchTerm(term);
  if (!cleaned) return [];

  const { data, error } = await supabase
    .from("motorcycle")
    .select("motorcycle_id")
    .or(buildMotorcycleSearchOrFilter(term, []))
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row: { motorcycle_id: string }) => row.motorcycle_id);
}

export type SearchWorkOrdersAtLocationOptions = {
  /** Max rows returned after merge (default 100). */
  limit?: number;
  /** Per-branch fetch size before merge (default max(limit*4, 24) capped at 80). */
  fetchLimit?: number;
};

/**
 * Location-scoped WO search: SQL ilike on WO/invoice numbers plus WOs linked to
 * matching customers (name/phone/email) and motorcycles (make/model/VIN/year/plate).
 */
export async function searchWorkOrdersAtLocation<T extends WoSearchRow>(
  supabase: DbClient,
  locationId: string,
  query: string,
  select: string,
  options: SearchWorkOrdersAtLocationOptions = {}
): Promise<T[]> {
  const cleaned = query.replace(/[%_]/g, "").trim();
  if (!cleaned || !locationId) return [];

  const limit = options.limit ?? 100;
  const fetchLimit = options.fetchLimit ?? Math.min(Math.max(limit * 4, 24), 80);
  const idLookupLimit = Math.min(fetchLimit, 50);
  const pattern = `%${escapeSearchTerm(cleaned)}%`;
  const numberOr = [
    `work_order_number.ilike.${JSON.stringify(pattern)}`,
    `external_invoice_number.ilike.${JSON.stringify(pattern)}`,
  ].join(",");

  const [numberResult, customerIds, motorcycleIds] = await Promise.all([
    supabase
      .from("work_order")
      .select(select)
      .eq("location_id", locationId)
      .or(numberOr)
      .order("date_created", { ascending: false })
      .limit(fetchLimit),
    findMatchingCustomerIds(supabase, cleaned, idLookupLimit),
    findMatchingMotorcycleIds(supabase, cleaned, idLookupLimit),
  ]);

  if (numberResult.error) throw numberResult.error;

  const relatedQueries: Array<PromiseLike<{ data: unknown; error: unknown }>> = [];

  if (customerIds.length > 0) {
    relatedQueries.push(
      supabase
        .from("work_order")
        .select(select)
        .eq("location_id", locationId)
        .in("customer_id", customerIds)
        .order("date_created", { ascending: false })
        .limit(fetchLimit)
    );
  }

  if (motorcycleIds.length > 0) {
    relatedQueries.push(
      supabase
        .from("work_order")
        .select(select)
        .eq("location_id", locationId)
        .in("motorcycle_id", motorcycleIds)
        .order("date_created", { ascending: false })
        .limit(fetchLimit)
    );
  }

  const relatedResults = await Promise.all(relatedQueries);
  for (const result of relatedResults) {
    if (result.error) throw result.error;
  }

  const merged = mergeByIdNewestFirst([
    ...((numberResult.data ?? []) as unknown as T[]),
    ...relatedResults.flatMap((result) => (result.data ?? []) as unknown as T[]),
  ]);

  return merged.slice(0, limit);
}
