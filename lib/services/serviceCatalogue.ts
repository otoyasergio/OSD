import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canManageServiceCatalogue } from "@/lib/permissions";
import { serviceSchema } from "@/lib/validation/schemas";

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

export type ServiceInput = {
  name: string;
  category?: string | null;
  standard_price?: number | null;
  estimated_labour?: number | null;
  active?: boolean;
};

const SERVICE_COLUMNS =
  "service_id, name, category, standard_price, estimated_labour, active, created_at, updated_at";

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

export async function listServices(
  options: { includeInactive?: boolean } = {}
): Promise<Service[]> {
  await requireUser();
  const supabase = await createClient();

  let query = supabase.from("service").select(SERVICE_COLUMNS);
  if (!options.includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query.order("name");
  if (error) throw error;
  return (data ?? []) as Service[];
}

async function requireCatalogueManager() {
  const user = await requireUser();
  if (!canManageServiceCatalogue(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export async function createService(input: ServiceInput): Promise<Service> {
  const user = await requireCatalogueManager();
  const parsed = serviceSchema.parse(input);

  const supabase = await createClient();
  const category = parsed.category?.trim() || null;

  const { data, error } = await supabase
    .from("service")
    .insert({
      name: parsed.name,
      category,
      standard_price: parsed.standard_price ?? null,
      estimated_labour: parsed.estimated_labour ?? null,
      active: parsed.active,
    })
    .select(SERVICE_COLUMNS)
    .single();

  if (error) throw error;
  const service = data as Service;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "service_created",
    entity_type: "service",
    entity_id: service.service_id,
    description: `Service ${service.name} created`,
    new_value: service,
  });

  return service;
}

export async function updateService(
  serviceId: string,
  input: ServiceInput
): Promise<Service> {
  const user = await requireCatalogueManager();
  const parsed = serviceSchema.parse(input);

  const supabase = await createClient();
  const { data: previous } = await supabase
    .from("service")
    .select(SERVICE_COLUMNS)
    .eq("service_id", serviceId)
    .maybeSingle();

  if (!previous) throw new Error("SERVICE_NOT_FOUND");

  const category = parsed.category?.trim() || null;

  const { data, error } = await supabase
    .from("service")
    .update({
      name: parsed.name,
      category,
      standard_price: parsed.standard_price ?? null,
      estimated_labour: parsed.estimated_labour ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("service_id", serviceId)
    .select(SERVICE_COLUMNS)
    .single();

  if (error) throw error;
  const service = data as Service;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "service_updated",
    entity_type: "service",
    entity_id: serviceId,
    description: `Service ${service.name} updated`,
    old_value: previous,
    new_value: service,
  });

  return service;
}

/** Services are never hard deleted; historical jobs keep their snapshot. */
export async function setServiceActive(
  serviceId: string,
  active: boolean
): Promise<Service> {
  const user = await requireCatalogueManager();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("service")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("service_id", serviceId)
    .select(SERVICE_COLUMNS)
    .single();

  if (error) throw error;
  const service = data as Service;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: active ? "service_reactivated" : "service_deactivated",
    entity_type: "service",
    entity_id: serviceId,
    description: `Service ${service.name} ${active ? "reactivated" : "deactivated"}`,
    old_value: { active: !active },
    new_value: { active },
  });

  return service;
}
