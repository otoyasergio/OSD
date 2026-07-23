import { cache } from "react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canManageServiceCatalogue } from "@/lib/permissions";
import { serviceSchema } from "@/lib/validation/schemas";
import {
  buildServiceVersionSnapshot,
  nextServiceVersionNo,
  shouldWriteServiceVersion,
  type Service,
  type ServicePricingMode,
  type ServiceVersionFields,
} from "@/lib/services/serviceCatalogueShared";

export type { Service, ServicePricingMode } from "@/lib/services/serviceCatalogueShared";
export {
  groupIntakeServicesByCategory,
  groupServicesByCategory,
  UNCATEGORISED_SERVICE_GROUP,
} from "@/lib/services/serviceCatalogueShared";

export type ServiceInput = {
  name: string;
  category?: string | null;
  standard_price?: number | null;
  estimated_labour?: number | null;
  active?: boolean;
  /** V2 catalogue pricing mode; snapshotted onto service_version only. */
  pricing_mode?: ServicePricingMode | null;
};

const SERVICE_COLUMNS =
  "service_id, name, category, standard_price, estimated_labour, active, created_at, updated_at";

async function listServicesUncached(
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

/** Request-scoped cache for the rarely changing service catalogue. */
export const listServices = cache(listServicesUncached);

async function requireCatalogueManager() {
  const user = await requireUser();
  if (!canManageServiceCatalogue(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export type ActiveServiceVersion = {
  service_id: string;
  version_no: number;
  pricing_mode: ServicePricingMode;
  fixed_package_price_cents: number | null;
  default_labor_minutes: number | null;
};

/**
 * Active catalogue version per service (V2). Returns an empty map when the
 * service_version migration has not been applied yet.
 */
export async function listActiveServiceVersions(): Promise<
  Map<string, ActiveServiceVersion>
> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_version")
    .select(
      "service_id, version_no, pricing_mode, fixed_package_price_cents, default_labor_minutes"
    )
    .eq("active", true);
  if (error) {
    console.warn("service_version read skipped (migration pending?)", error.message);
    return new Map();
  }
  return new Map(
    ((data ?? []) as ActiveServiceVersion[]).map((row) => [row.service_id, row])
  );
}

/**
 * Append a catalogue version snapshot (V2 dual-write). V2 tables deny client
 * writes, so this uses the service-role client. Failures are swallowed with a
 * warning so catalogue editing keeps working before the migration is applied.
 */
async function writeServiceVersionSnapshot(
  serviceId: string,
  next: ServiceVersionFields,
  actorUserId: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: latest, error: latestError } = await admin
      .from("service_version")
      .select(
        "version_no, name_snapshot, category_snapshot, pricing_mode, fixed_package_price_cents, default_labor_minutes"
      )
      .eq("service_id", serviceId)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    const nextSnapshot = buildServiceVersionSnapshot(next);
    // Re-saving the same pricing mode keeps the stored one when the caller
    // did not choose one explicitly (legacy forms without the selector).
    if (next.pricing_mode == null && latest?.pricing_mode) {
      nextSnapshot.pricing_mode = latest.pricing_mode as ServicePricingMode;
    }
    const previousSnapshot = latest
      ? {
          name_snapshot: latest.name_snapshot as string,
          category_snapshot: latest.category_snapshot as string | null,
          pricing_mode: latest.pricing_mode as ServicePricingMode,
          fixed_package_price_cents: latest.fixed_package_price_cents as number | null,
          default_labor_minutes: latest.default_labor_minutes as number | null,
        }
      : null;
    if (!shouldWriteServiceVersion(previousSnapshot, nextSnapshot)) return;

    const versionNo = nextServiceVersionNo(
      (latest?.version_no as number | undefined) ?? null
    );
    const now = new Date().toISOString();

    const { error: deactivateError } = await admin
      .from("service_version")
      .update({ active: false, effective_to: now })
      .eq("service_id", serviceId)
      .eq("active", true);
    if (deactivateError) throw deactivateError;

    const { error: insertError } = await admin.from("service_version").insert({
      service_id: serviceId,
      version_no: versionNo,
      ...nextSnapshot,
      active: true,
      effective_from: now,
      created_by_user_id: actorUserId,
    });
    if (insertError) throw insertError;
  } catch (error) {
    // Rolling-deploy safety: catalogue editing must survive a missing
    // service_version table / policy while the V2 migration rolls out.
    console.warn(
      "service_version snapshot skipped",
      error instanceof Error ? error.message : error
    );
  }
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

  await writeServiceVersionSnapshot(
    service.service_id,
    {
      name: service.name,
      category: service.category,
      standard_price: service.standard_price,
      estimated_labour: service.estimated_labour,
      pricing_mode: parsed.pricing_mode ?? null,
    },
    user.user_id
  );

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

  await writeServiceVersionSnapshot(
    serviceId,
    {
      name: service.name,
      category: service.category,
      standard_price: service.standard_price,
      estimated_labour: service.estimated_labour,
      pricing_mode: parsed.pricing_mode ?? null,
    },
    user.user_id
  );

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
