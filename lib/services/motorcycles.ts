import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canAdminHelpCreateRecords,
  canEditWorkOrder,
  canUpdateServiceInformation,
  canViewClients,
} from "@/lib/permissions";
import { motorcycleSchema } from "@/lib/validation/schemas";
import { escapeSearchTerm } from "@/lib/services/customers";
import { normalizeVin } from "@/lib/vin";
import type { MileageUnit } from "@/lib/mileage/format";
import {
  buildServiceInfoFromFitmentRows,
  mergeServiceInfoFill,
  type FitmentPayload,
} from "@/lib/fitment/serviceInfoFromFitment";

export type Motorcycle = {
  motorcycle_id: string;
  customer_id: string;
  year: number;
  make: string;
  model: string;
  odometer_unit: MileageUnit;
  vin: string | null;
  colour: string | null;
  plate_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MotorcycleWithCustomer = Motorcycle & {
  customer: { first_name: string; last_name: string } | null;
};

export type ServiceInformation = {
  service_information_id: string;
  motorcycle_id: string;
  oil_filter: string | null;
  oil_type: string | null;
  oil_capacity: string | null;
  air_filter: string | null;
  spark_plugs: string | null;
  front_brake_pads: string | null;
  rear_brake_pads: string | null;
  front_tire_size: string | null;
  rear_tire_size: string | null;
  chain: string | null;
  battery: string | null;
  notes: string | null;
  last_updated: string;
  last_updated_by_user_id: string | null;
};

export type MotorcycleInput = {
  customer_id: string;
  year: number;
  make: string;
  model: string;
  odometer_unit: MileageUnit;
  vin?: string | null;
  colour?: string | null;
  plate_number?: string | null;
  notes?: string | null;
};

export type TransferMotorcycleInput = {
  motorcycle_id: string;
  new_customer_id: string;
};

export type VinOwnershipConflict = {
  motorcycle_id: string;
  customer_id: string;
  owner_name: string;
  bike_label: string;
  vin: string;
};

/**
 * Pure validation for ownership transfer. Used by transferMotorcycle and unit tests.
 */
export function validateMotorcycleTransfer(args: {
  motorcycle: { motorcycle_id: string; customer_id: string } | null;
  newCustomer: { customer_id: string } | null;
  new_customer_id: string;
}): { from_customer_id: string; to_customer_id: string } {
  if (!args.motorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");
  if (!args.newCustomer) throw new Error("CUSTOMER_NOT_FOUND");
  if (args.motorcycle.customer_id === args.new_customer_id) {
    throw new Error("SAME_CUSTOMER");
  }
  return {
    from_customer_id: args.motorcycle.customer_id,
    to_customer_id: args.new_customer_id,
  };
}

export function isVinOwnedByOtherCustomer(args: {
  existing: {
    motorcycle_id: string;
    customer_id: string;
  } | null;
  currentCustomerId: string;
  excludeMotorcycleId?: string | null;
}): boolean {
  if (!args.existing) return false;
  if (
    args.excludeMotorcycleId &&
    args.existing.motorcycle_id === args.excludeMotorcycleId
  ) {
    return false;
  }
  return args.existing.customer_id !== args.currentCustomerId;
}

export function buildVinOwnershipConflict(existing: {
  motorcycle_id: string;
  customer_id: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  customer: { first_name: string; last_name: string } | null;
}): VinOwnershipConflict {
  return {
    motorcycle_id: existing.motorcycle_id,
    customer_id: existing.customer_id,
    owner_name: existing.customer
      ? `${existing.customer.first_name} ${existing.customer.last_name}`
      : "another customer",
    bike_label: `${existing.year} ${existing.make} ${existing.model}`,
    vin: existing.vin ?? "",
  };
}

export const SERVICE_INFORMATION_FIELDS = [
  "oil_filter",
  "oil_type",
  "oil_capacity",
  "air_filter",
  "spark_plugs",
  "front_brake_pads",
  "rear_brake_pads",
  "front_tire_size",
  "rear_tire_size",
  "chain",
  "battery",
  "notes",
] as const;

export type ServiceInformationInput = Partial<
  Record<(typeof SERVICE_INFORMATION_FIELDS)[number], string | null>
>;

const MOTORCYCLE_COLUMNS =
  "motorcycle_id, customer_id, year, make, model, odometer_unit, vin, colour, plate_number, notes, created_at, updated_at";

const SERVICE_INFORMATION_COLUMNS =
  "service_information_id, motorcycle_id, oil_filter, oil_type, oil_capacity, air_filter, spark_plugs, front_brake_pads, rear_brake_pads, front_tire_size, rear_tire_size, chain, battery, notes, last_updated, last_updated_by_user_id";

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isYear(term: string): boolean {
  return /^\d{4}$/.test(term);
}

export function buildMotorcycleSearchOrFilter(
  term: string,
  customerIds: string[]
): string {
  const cleaned = escapeSearchTerm(term);
  const pattern = `%${cleaned}%`;
  const filters = [
    `make.ilike.${pattern}`,
    `model.ilike.${pattern}`,
    `vin.ilike.${pattern}`,
    `plate_number.ilike.${pattern}`,
  ];

  if (isYear(cleaned)) {
    filters.push(`year.eq.${cleaned}`);
  }

  if (customerIds.length > 0) {
    filters.push(`customer_id.in.(${customerIds.join(",")})`);
  }

  return filters.join(",");
}

export async function countMotorcycles(): Promise<number> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("motorcycle")
    .select("motorcycle_id", { count: "exact", head: true });

  if (error) throw error;
  return count ?? 0;
}

export async function searchMotorcycles(term: string): Promise<MotorcycleWithCustomer[]> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const cleaned = escapeSearchTerm(term);

  let query = supabase
    .from("motorcycle")
    .select(`${MOTORCYCLE_COLUMNS}, customer:customer_id(first_name, last_name)`);

  if (cleaned) {
    const { data: customerRows } = await supabase
      .from("customer")
      .select("customer_id")
      .or(`first_name.ilike.%${cleaned}%,last_name.ilike.%${cleaned}%`);
    const customerIds = (customerRows ?? []).map(
      (row: { customer_id: string }) => row.customer_id
    );
    query = query.or(buildMotorcycleSearchOrFilter(term, customerIds));
  }

  const { data, error } = await query.order("year", { ascending: false }).limit(50);

  if (error) throw error;
  return (data ?? []) as unknown as MotorcycleWithCustomer[];
}

export async function listMotorcyclesForCustomer(
  customerId: string
): Promise<Motorcycle[]> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("motorcycle")
    .select(MOTORCYCLE_COLUMNS)
    .eq("customer_id", customerId)
    .order("year", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Motorcycle[];
}

export async function getMotorcycleById(
  motorcycleId: string
): Promise<MotorcycleWithCustomer | null> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("motorcycle")
    .select(`${MOTORCYCLE_COLUMNS}, customer:customer_id(first_name, last_name)`)
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as MotorcycleWithCustomer) ?? null;
}

/** Exact match on normalized VIN (uppercase, no spaces/dashes). */
export async function findMotorcycleByVin(
  vin: string
): Promise<MotorcycleWithCustomer | null> {
  await requireUser();
  const normalized = normalizeVin(vin);
  if (!normalized) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("motorcycle")
    .select(`${MOTORCYCLE_COLUMNS}, customer:customer_id(first_name, last_name)`)
    .eq("vin", normalized)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as MotorcycleWithCustomer) ?? null;
}

/**
 * Soft unique VIN lookup for forms. Returns a conflict when another customer
 * owns the VIN. Same-customer duplicates are left to assertVinAvailable on save.
 */
export async function lookupVinOwnershipConflict(args: {
  vin: string;
  currentCustomerId: string;
  excludeMotorcycleId?: string | null;
}): Promise<VinOwnershipConflict | null> {
  const existing = await findMotorcycleByVin(args.vin);
  if (
    !isVinOwnedByOtherCustomer({
      existing,
      currentCustomerId: args.currentCustomerId,
      excludeMotorcycleId: args.excludeMotorcycleId,
    })
  ) {
    return null;
  }
  return buildVinOwnershipConflict(existing!);
}

async function assertVinAvailable(args: {
  vin: string | null;
  excludeMotorcycleId?: string | null;
}): Promise<void> {
  if (!args.vin) return;
  const existing = await findMotorcycleByVin(args.vin);
  if (!existing) return;
  if (args.excludeMotorcycleId && existing.motorcycle_id === args.excludeMotorcycleId) {
    return;
  }
  throw new Error("VIN_ALREADY_EXISTS");
}

export async function getServiceInformation(
  motorcycleId: string
): Promise<ServiceInformation | null> {
  await requireUser();
  const supabase = await createClient();

  let info = await loadServiceInformation(supabase, motorcycleId);
  if (info) {
    const motorcycle = await getMotorcycleById(motorcycleId);
    if (motorcycle) {
      const filled = await fillServiceInformationFromFitment(supabase, motorcycle, info, {
        refreshFitmentValues: true,
      });
      if (filled > 0) {
        info = await loadServiceInformation(supabase, motorcycleId);
      }
    }
  }
  return info;
}

async function loadServiceInformation(
  supabase: DbClient,
  motorcycleId: string
): Promise<ServiceInformation | null> {
  const { data, error } = await supabase
    .from("motorcycle_service_information")
    .select(SERVICE_INFORMATION_COLUMNS)
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();

  if (error) throw error;
  return (data as ServiceInformation) ?? null;
}

async function fillServiceInformationFromFitment(
  supabase: DbClient,
  motorcycle: Pick<Motorcycle, "motorcycle_id" | "year" | "make" | "model">,
  existing: ServiceInformation,
  options: { refreshFitmentValues?: boolean } = {}
): Promise<number> {
  const { data, error } = await supabase
    .from("fitment_vehicle")
    .select("make, model, year_start, year_end, spec_data, part_data")
    .ilike("make", motorcycle.make);

  if (error) throw error;

  const rows = (data ?? []).map((row) => ({
    make: row.make as string,
    model: row.model as string,
    year_start: row.year_start as number,
    year_end: row.year_end as number,
    spec_data: (row.spec_data as Record<string, string>) ?? {},
    part_data: (row.part_data as Record<string, string>) ?? {},
  })) satisfies FitmentPayload[];

  const mapped = buildServiceInfoFromFitmentRows(
    rows,
    motorcycle.year,
    motorcycle.make,
    motorcycle.model
  );
  if (!mapped) return 0;

  const { next, filledCount } = mergeServiceInfoFill(existing, mapped, options);
  if (filledCount === 0) return 0;

  const { error: updateError } = await supabase
    .from("motorcycle_service_information")
    .update({
      oil_filter: next.oil_filter,
      oil_type: next.oil_type,
      oil_capacity: next.oil_capacity ?? existing.oil_capacity,
      air_filter: next.air_filter,
      spark_plugs: next.spark_plugs,
      front_brake_pads: next.front_brake_pads,
      rear_brake_pads: next.rear_brake_pads,
      front_tire_size: next.front_tire_size,
      rear_tire_size: next.rear_tire_size,
      chain: next.chain,
      battery: next.battery,
      last_updated: new Date().toISOString(),
    })
    .eq("motorcycle_id", motorcycle.motorcycle_id);

  if (updateError) throw updateError;
  return filledCount;
}

export async function createMotorcycle(input: MotorcycleInput): Promise<Motorcycle> {
  const user = await requireUser();
  if (!canAdminHelpCreateRecords(user.role)) throw new Error("FORBIDDEN");

  const parsed = motorcycleSchema.parse({
    ...input,
    vin: normalizeOptional(input.vin),
    colour: normalizeOptional(input.colour),
    plate_number: normalizeOptional(input.plate_number),
    notes: normalizeOptional(input.notes),
  });

  const supabase = await createClient();
  await assertVinAvailable({ vin: normalizeOptional(parsed.vin) });

  const { data, error } = await supabase
    .from("motorcycle")
    .insert({
      customer_id: parsed.customer_id,
      year: parsed.year,
      make: parsed.make,
      model: parsed.model,
      odometer_unit: parsed.odometer_unit,
      vin: normalizeOptional(parsed.vin),
      colour: normalizeOptional(parsed.colour),
      plate_number: normalizeOptional(parsed.plate_number),
      notes: normalizeOptional(parsed.notes),
    })
    .select(MOTORCYCLE_COLUMNS)
    .single();

  if (error) throw error;
  const motorcycle = data as Motorcycle;

  const { error: serviceInfoError } = await supabase
    .from("motorcycle_service_information")
    .insert({ motorcycle_id: motorcycle.motorcycle_id });
  if (serviceInfoError) throw serviceInfoError;

  const emptyInfo = await loadServiceInformation(supabase, motorcycle.motorcycle_id);
  if (emptyInfo) {
    await fillServiceInformationFromFitment(supabase, motorcycle, emptyInfo);
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "motorcycle_created",
    entity_type: "motorcycle",
    entity_id: motorcycle.motorcycle_id,
    description: `Motorcycle ${motorcycle.year} ${motorcycle.make} ${motorcycle.model} created`,
    new_value: motorcycle,
  });

  return motorcycle;
}

export async function updateMotorcycle(
  motorcycleId: string,
  input: MotorcycleInput
): Promise<Motorcycle> {
  const user = await requireUser();
  if (!canAdminHelpCreateRecords(user.role)) throw new Error("FORBIDDEN");

  const parsed = motorcycleSchema.parse({
    ...input,
    vin: normalizeOptional(input.vin),
    colour: normalizeOptional(input.colour),
    plate_number: normalizeOptional(input.plate_number),
    notes: normalizeOptional(input.notes),
  });

  const supabase = await createClient();
  const previous = await getMotorcycleById(motorcycleId);
  if (!previous) throw new Error("MOTORCYCLE_NOT_FOUND");

  await assertVinAvailable({
    vin: normalizeOptional(parsed.vin),
    excludeMotorcycleId: motorcycleId,
  });

  const { data, error } = await supabase
    .from("motorcycle")
    .update({
      customer_id: parsed.customer_id,
      year: parsed.year,
      make: parsed.make,
      model: parsed.model,
      odometer_unit: parsed.odometer_unit,
      vin: normalizeOptional(parsed.vin),
      colour: normalizeOptional(parsed.colour),
      plate_number: normalizeOptional(parsed.plate_number),
      notes: normalizeOptional(parsed.notes),
      updated_at: new Date().toISOString(),
    })
    .eq("motorcycle_id", motorcycleId)
    .select(MOTORCYCLE_COLUMNS)
    .single();

  if (error) throw error;
  const motorcycle = data as Motorcycle;

  const ymmChanged =
    previous.year !== motorcycle.year ||
    previous.make !== motorcycle.make ||
    previous.model !== motorcycle.model;
  if (ymmChanged) {
    const info = await loadServiceInformation(supabase, motorcycleId);
    if (info) {
      await fillServiceInformationFromFitment(supabase, motorcycle, info, {
        refreshFitmentValues: true,
      });
    }
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "motorcycle_updated",
    entity_type: "motorcycle",
    entity_id: motorcycleId,
    description: `Motorcycle ${motorcycle.year} ${motorcycle.make} ${motorcycle.model} updated`,
    old_value: previous,
    new_value: motorcycle,
  });

  return motorcycle;
}

/**
 * Move a motorcycle to another customer's garage. Same motorcycle_id / VIN /
 * service info / WO history stay; only motorcycle.customer_id changes.
 * Past work orders keep their visit customer via work_order.customer_id.
 */
export async function transferMotorcycle(
  input: TransferMotorcycleInput
): Promise<Motorcycle> {
  const user = await requireUser();
  if (!canEditWorkOrder(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();

  const { data: motorcycleRow, error: motorcycleError } = await supabase
    .from("motorcycle")
    .select(MOTORCYCLE_COLUMNS)
    .eq("motorcycle_id", input.motorcycle_id)
    .maybeSingle();

  if (motorcycleError) throw motorcycleError;

  const { data: newCustomer, error: customerError } = await supabase
    .from("customer")
    .select("customer_id, first_name, last_name")
    .eq("customer_id", input.new_customer_id)
    .maybeSingle();

  if (customerError) throw customerError;

  const { from_customer_id, to_customer_id } = validateMotorcycleTransfer({
    motorcycle: motorcycleRow as Motorcycle | null,
    newCustomer,
    new_customer_id: input.new_customer_id,
  });

  const { data, error } = await supabase
    .from("motorcycle")
    .update({
      customer_id: to_customer_id,
      updated_at: new Date().toISOString(),
    })
    .eq("motorcycle_id", input.motorcycle_id)
    .select(MOTORCYCLE_COLUMNS)
    .single();

  if (error) throw error;
  const motorcycle = data as Motorcycle;

  const bikeLabel = `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`;
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "motorcycle_transferred",
    entity_type: "motorcycle",
    entity_id: motorcycle.motorcycle_id,
    description: `Motorcycle ${bikeLabel} transferred to new owner`,
    old_value: {
      customer_id: from_customer_id,
      motorcycle_id: motorcycle.motorcycle_id,
    },
    new_value: {
      customer_id: to_customer_id,
      motorcycle_id: motorcycle.motorcycle_id,
      new_customer_name: newCustomer
        ? `${newCustomer.first_name} ${newCustomer.last_name}`
        : null,
    },
  });

  return motorcycle;
}

export async function updateMotorcycleServiceInformation(
  motorcycleId: string,
  input: ServiceInformationInput,
  options: { work_order_id?: string | null } = {}
): Promise<ServiceInformation> {
  const user = await requireUser();
  if (!canUpdateServiceInformation(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const previous = await loadServiceInformation(supabase, motorcycleId);
  if (!previous) throw new Error("MOTORCYCLE_NOT_FOUND");

  const patch: Record<string, string | null> = {};
  for (const field of SERVICE_INFORMATION_FIELDS) {
    patch[field] = normalizeOptional(input[field]);
  }

  const { data, error } = await supabase
    .from("motorcycle_service_information")
    .update({
      ...patch,
      last_updated: new Date().toISOString(),
      last_updated_by_user_id: user.user_id,
    })
    .eq("motorcycle_id", motorcycleId)
    .select(SERVICE_INFORMATION_COLUMNS)
    .single();

  if (error) throw error;
  const serviceInformation = data as ServiceInformation;

  if (options.work_order_id) {
    await addTimelineEvent(supabase, {
      work_order_id: options.work_order_id,
      user_id: user.user_id,
      event_type: TimelineEventType.SERVICE_INFORMATION_UPDATED,
      entity_type: "motorcycle_service_information",
      entity_id: serviceInformation.service_information_id,
      description: "Service information updated",
      old_value: previous,
      new_value: serviceInformation,
    });
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "service_information_updated",
    entity_type: "motorcycle_service_information",
    entity_id: serviceInformation.service_information_id,
    description: "Motorcycle service information updated",
    old_value: previous,
    new_value: serviceInformation,
  });

  return serviceInformation;
}
