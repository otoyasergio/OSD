import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canAdminHelpCreateRecords,
  canUpdateServiceInformation,
} from "@/lib/permissions";
import { motorcycleSchema } from "@/lib/validation/schemas";
import { escapeSearchTerm } from "@/lib/services/customers";

export type Motorcycle = {
  motorcycle_id: string;
  customer_id: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  colour: string | null;
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
  vin?: string | null;
  colour?: string | null;
  notes?: string | null;
};

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
  "motorcycle_id, customer_id, year, make, model, vin, colour, notes, created_at, updated_at";

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
  await requireUser();
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("motorcycle")
    .select("motorcycle_id", { count: "exact", head: true });

  if (error) throw error;
  return count ?? 0;
}

export async function searchMotorcycles(
  term: string
): Promise<MotorcycleWithCustomer[]> {
  await requireUser();
  const supabase = await createClient();
  const cleaned = escapeSearchTerm(term);

  let query = supabase
    .from("motorcycle")
    .select(`${MOTORCYCLE_COLUMNS}, customer:customer_id(first_name, last_name)`);

  if (cleaned) {
    const { data: customerRows } = await supabase
      .from("customer")
      .select("customer_id")
      .or(
        `first_name.ilike.%${cleaned}%,last_name.ilike.%${cleaned}%`
      );
    const customerIds = (customerRows ?? []).map(
      (row: { customer_id: string }) => row.customer_id
    );
    query = query.or(buildMotorcycleSearchOrFilter(term, customerIds));
  }

  const { data, error } = await query
    .order("year", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as unknown as MotorcycleWithCustomer[];
}

export async function listMotorcyclesForCustomer(
  customerId: string
): Promise<Motorcycle[]> {
  await requireUser();
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
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("motorcycle")
    .select(`${MOTORCYCLE_COLUMNS}, customer:customer_id(first_name, last_name)`)
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as MotorcycleWithCustomer) ?? null;
}

export async function getServiceInformation(
  motorcycleId: string
): Promise<ServiceInformation | null> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("motorcycle_service_information")
    .select(SERVICE_INFORMATION_COLUMNS)
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();

  if (error) throw error;
  return (data as ServiceInformation) ?? null;
}

export async function createMotorcycle(
  input: MotorcycleInput
): Promise<Motorcycle> {
  const user = await requireUser();
  if (!canAdminHelpCreateRecords(user.role)) throw new Error("FORBIDDEN");

  const parsed = motorcycleSchema.parse({
    ...input,
    vin: normalizeOptional(input.vin),
    colour: normalizeOptional(input.colour),
    notes: normalizeOptional(input.notes),
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("motorcycle")
    .insert({
      customer_id: parsed.customer_id,
      year: parsed.year,
      make: parsed.make,
      model: parsed.model,
      vin: normalizeOptional(parsed.vin),
      colour: normalizeOptional(parsed.colour),
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
    notes: normalizeOptional(input.notes),
  });

  const supabase = await createClient();
  const previous = await getMotorcycleById(motorcycleId);
  if (!previous) throw new Error("MOTORCYCLE_NOT_FOUND");

  const { data, error } = await supabase
    .from("motorcycle")
    .update({
      customer_id: parsed.customer_id,
      year: parsed.year,
      make: parsed.make,
      model: parsed.model,
      vin: normalizeOptional(parsed.vin),
      colour: normalizeOptional(parsed.colour),
      notes: normalizeOptional(parsed.notes),
      updated_at: new Date().toISOString(),
    })
    .eq("motorcycle_id", motorcycleId)
    .select(MOTORCYCLE_COLUMNS)
    .single();

  if (error) throw error;
  const motorcycle = data as Motorcycle;

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

export async function updateMotorcycleServiceInformation(
  motorcycleId: string,
  input: ServiceInformationInput,
  options: { work_order_id?: string | null } = {}
): Promise<ServiceInformation> {
  const user = await requireUser();
  if (!canUpdateServiceInformation(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const previous = await getServiceInformation(motorcycleId);
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
