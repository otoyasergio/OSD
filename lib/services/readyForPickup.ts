import { requireUser } from "@/lib/auth/session";
import { clientDisplayName } from "@/lib/customers/displayName";
import { isUndefinedColumnError } from "@/lib/database/schemaCompat";
import { createClient } from "@/lib/database/supabase-server";
import type { WorkOrderStatus } from "@/lib/database/types";
import { resolveBoardPrimaryPhotos } from "@/lib/services/photos";

/** Bike waiting in a shop-floor stage queue (pickup, safety, etc.). */
export type WaitingStageBike = {
  work_order_id: string;
  work_order_number: string;
  motorcycle_label: string;
  /** Office boards only. The tech floor leaves this unset so client names stay off that screen. */
  customer_name?: string | null;
  /** When the bike entered this waiting stage; may fall back to updated_at. */
  ready_since: string;
  /** True when the preferred stamp was null and we used updated_at. */
  ready_since_inferred: boolean;
  primary_photo_url: string | null;
  overview_href: string;
};

/** @deprecated Prefer WaitingStageBike — kept for existing call sites. */
export type ReadyForPickupItem = WaitingStageBike;

type NestedMotorcycle = {
  year: number;
  make: string;
  model: string;
} | null;

type NestedCustomer = {
  first_name: string;
  last_name: string;
} | null;

type StageRow = {
  work_order_id: string;
  work_order_number: string;
  ready_for_pickup_at: string | null;
  quality_checked_at: string | null;
  stored_at?: string | null;
  updated_at: string;
  motorcycle: NestedMotorcycle | NestedMotorcycle[];
  customer?: NestedCustomer | NestedCustomer[] | null;
};

const STAGE_BIKE_SELECT = `
      work_order_id,
      work_order_number,
      ready_for_pickup_at,
      quality_checked_at,
      updated_at,
      motorcycle:motorcycle_id ( year, make, model )
    `;

const STAGE_BIKE_SELECT_WITH_CUSTOMER = `
      work_order_id,
      work_order_number,
      ready_for_pickup_at,
      quality_checked_at,
      updated_at,
      motorcycle:motorcycle_id ( year, make, model ),
      customer:customer_id (
        first_name,
        last_name
      )
    `;

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function listWaitingStageBikes(input: {
  status: WorkOrderStatus;
  since: (row: StageRow) => { at: string | null; inferredFallback: string };
  orderColumn: "ready_for_pickup_at" | "quality_checked_at" | "updated_at";
  /** Defaults to work-order overview. */
  hrefFor?: (workOrderId: string) => string;
  /** Control Center shows the client. The tech floor must not. */
  includeCustomer?: boolean;
}): Promise<WaitingStageBike[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;
  const hrefFor = input.hrefFor ?? ((id: string) => `/work_orders/${id}`);

  const { data, error } = await supabase
    .from("work_order")
    .select(input.includeCustomer ? STAGE_BIKE_SELECT_WITH_CUSTOMER : STAGE_BIKE_SELECT)
    .eq("location_id", locationId)
    .eq("status", input.status)
    .order(input.orderColumn, { ascending: true, nullsFirst: false })
    // Control Center renders every row it gets; keep the queue bounded so a
    // backlog can't turn one render into hundreds of photo signings.
    .limit(60);

  if (error) throw error;

  const rows = (data ?? []) as unknown as StageRow[];
  const { urls } = await resolveBoardPrimaryPhotos(
    supabase,
    rows.map((row) => row.work_order_id)
  );

  return rows.map((row) => {
    const motorcycle = asOne(row.motorcycle);
    const { at, inferredFallback } = input.since(row);
    return {
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      motorcycle_label: motorcycle
        ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
        : "—",
      customer_name: input.includeCustomer ? clientDisplayName(row.customer) : null,
      ready_since: at ?? inferredFallback,
      ready_since_inferred: !at,
      primary_photo_url: urls.get(row.work_order_id) ?? null,
      overview_href: hrefFor(row.work_order_id),
    };
  });
}

/**
 * Location-scoped work orders currently waiting for customer pickup.
 * Primary surface: Control Center (below tech columns). Also shown on the
 * tech floor for shop awareness (no customer PII).
 */
export async function listReadyForPickup(input?: {
  /** Defaults to work-order overview (Control Center / office). */
  hrefFor?: (workOrderId: string) => string;
  /** Control Center shows the client. The tech floor must not. */
  includeCustomer?: boolean;
}): Promise<WaitingStageBike[]> {
  return listWaitingStageBikes({
    status: "ready_for_pickup",
    orderColumn: "ready_for_pickup_at",
    since: (row) => ({
      at: row.ready_for_pickup_at,
      inferredFallback: row.updated_at,
    }),
    hrefFor: input?.hrefFor,
    includeCustomer: input?.includeCustomer,
  });
}

/**
 * Location-scoped work orders in `waiting_for_parts`.
 * Control Center stack: under tech columns, above QC.
 * Links open the work-order Parts tab so staff see what is on order.
 * Wait timer uses updated_at (no dedicated parts-entered stamp).
 */
export async function listWaitingForParts(): Promise<WaitingStageBike[]> {
  return listWaitingStageBikes({
    status: "waiting_for_parts",
    orderColumn: "updated_at",
    since: (row) => ({
      at: null,
      inferredFallback: row.updated_at,
    }),
    hrefFor: (workOrderId) => `/work_orders/${workOrderId}?tab=parts`,
    includeCustomer: true,
  });
}

/**
 * Location-scoped work orders in `quality_check` awaiting QC.
 * Control Center stack: under tech columns, above safety inspection.
 * Wait timer uses updated_at (no dedicated QC-entered stamp).
 */
export async function listReadyForQc(): Promise<WaitingStageBike[]> {
  return listWaitingStageBikes({
    status: "quality_check",
    orderColumn: "updated_at",
    since: (row) => ({
      at: null,
      inferredFallback: row.updated_at,
    }),
    includeCustomer: true,
  });
}

/**
 * Location-scoped work orders in `safety_check` awaiting a safety inspection.
 * Shown on Control Center under the technician columns (above ready-for-pickup).
 * Wait timer prefers quality_checked_at (typical entry into the safety queue).
 */
export async function listReadyForSafetyInspection(): Promise<WaitingStageBike[]> {
  return listWaitingStageBikes({
    status: "safety_check",
    orderColumn: "quality_checked_at",
    since: (row) => ({
      at: row.quality_checked_at,
      inferredFallback: row.updated_at,
    }),
    includeCustomer: true,
  });
}

/**
 * Location-scoped work orders in storage. The bike stays in the building
 * after work is finished. Timer prefers stored_at.
 */
export async function listInStorage(): Promise<WaitingStageBike[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;

  const storageSelect = `
      work_order_id,
      work_order_number,
      stored_at,
      updated_at,
      motorcycle:motorcycle_id ( year, make, model ),
      customer:customer_id (
        first_name,
        last_name
      )
    `;
  const { data, error } = await supabase
    .from("work_order")
    .select(storageSelect)
    .eq("location_id", locationId)
    .eq("status", "in_storage")
    .order("stored_at", { ascending: true, nullsFirst: false })
    .limit(60);

  if (error && isUndefinedColumnError(error, "stored_at")) {
    return listWaitingStageBikes({
      status: "in_storage",
      orderColumn: "updated_at",
      since: (row) => ({ at: null, inferredFallback: row.updated_at }),
      includeCustomer: true,
    });
  }
  if (error) throw error;

  const rows = (data ?? []) as unknown as StageRow[];
  const { urls } = await resolveBoardPrimaryPhotos(
    supabase,
    rows.map((row) => row.work_order_id)
  );

  return rows.map((row) => {
    const motorcycle = asOne(row.motorcycle);
    return {
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      motorcycle_label: motorcycle
        ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
        : "—",
      customer_name: clientDisplayName(row.customer),
      ready_since: row.stored_at ?? row.updated_at,
      ready_since_inferred: !row.stored_at,
      primary_photo_url: urls.get(row.work_order_id) ?? null,
      overview_href: `/work_orders/${row.work_order_id}`,
    };
  });
}

/**
 * Recently completed work orders for Control Center "Complete" box.
 * Last 7 days at the active location, newest first (capped).
 */
export async function listRecentlyCompleted(): Promise<WaitingStageBike[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);

  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      ready_for_pickup_at,
      quality_checked_at,
      updated_at,
      completed_at,
      motorcycle:motorcycle_id (
        year,
        make,
        model
      ),
      customer:customer_id (
        first_name,
        last_name
      )
    `
    )
    .eq("location_id", locationId)
    .eq("status", "completed")
    .gte("completed_at", since.toISOString())
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(24);

  if (error) throw error;

  type CompletedRow = StageRow & { completed_at: string | null };
  const rows = (data ?? []) as CompletedRow[];
  const { urls } = await resolveBoardPrimaryPhotos(
    supabase,
    rows.map((row) => row.work_order_id)
  );

  return rows.map((row) => {
    const motorcycle = asOne(row.motorcycle);
    const completedAt = row.completed_at ?? row.updated_at;
    return {
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      motorcycle_label: motorcycle
        ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
        : "—",
      customer_name: clientDisplayName(row.customer),
      ready_since: completedAt,
      ready_since_inferred: !row.completed_at,
      primary_photo_url: urls.get(row.work_order_id) ?? null,
      overview_href: `/work_orders/${row.work_order_id}`,
    };
  });
}
