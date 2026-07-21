import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canViewAuditLog } from "@/lib/permissions";

/**
 * Global audit log reads are owner-only in app permissions and RLS
 * (`audit_log_select_owner`). Writes are append-only (INSERT); UPDATE/DELETE
 * are denied at the policy layer. See docs/superpowers/acceptance/rls-audit.md.
 */

export type AuditLogEntry = {
  audit_log_id: string;
  actor_user_id: string | null;
  location_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
  actor?: {
    user_id: string;
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  location?: {
    location_id: string;
    name: string;
    code: string;
  } | null;
};

export type AuditLogFilters = {
  from?: string | null;
  to?: string | null;
  actor_user_id?: string | null;
  location_id?: string | null;
  entity_type?: string | null;
  action?: string | null;
  limit?: number;
};

export type AuditFilterOption = {
  id: string;
  label: string;
};

export async function listAuditLogs(
  filters: AuditLogFilters = {}
): Promise<AuditLogEntry[]> {
  const user = await requireUser();
  if (!canViewAuditLog(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select(
      `
      audit_log_id,
      actor_user_id,
      location_id,
      action,
      entity_type,
      entity_id,
      description,
      old_value,
      new_value,
      created_at,
      actor:actor_user_id (
        user_id,
        first_name,
        last_name,
        email
      ),
      location:location_id (
        location_id,
        name,
        code
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.from) {
    query = query.gte("created_at", filters.from);
  }
  if (filters.to) {
    // Inclusive end-of-day when only a date is provided
    const toValue = filters.to.includes("T") ? filters.to : `${filters.to}T23:59:59.999Z`;
    query = query.lte("created_at", toValue);
  }
  if (filters.actor_user_id) {
    query = query.eq("actor_user_id", filters.actor_user_id);
  }
  if (filters.location_id) {
    query = query.eq("location_id", filters.location_id);
  }
  if (filters.entity_type) {
    query = query.eq("entity_type", filters.entity_type);
  }
  if (filters.action?.trim()) {
    query = query.ilike("action", `%${filters.action.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as AuditLogEntry[];
}

export async function listAuditFilterOptions(): Promise<{
  actors: AuditFilterOption[];
  locations: AuditFilterOption[];
  entityTypes: string[];
}> {
  const user = await requireUser();
  if (!canViewAuditLog(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();

  const [actorsRes, locationsRes, entityRes] = await Promise.all([
    supabase
      .from("app_user")
      .select("user_id, first_name, last_name, email")
      .order("last_name", { ascending: true }),
    supabase
      .from("location")
      .select("location_id, name, code")
      .order("name", { ascending: true }),
    supabase
      .from("audit_log")
      .select("entity_type")
      .order("entity_type", { ascending: true })
      .limit(500),
  ]);

  if (actorsRes.error) throw actorsRes.error;
  if (locationsRes.error) throw locationsRes.error;
  if (entityRes.error) throw entityRes.error;

  const entityTypes = Array.from(
    new Set((entityRes.data ?? []).map((row) => row.entity_type as string))
  ).sort();

  return {
    actors: (actorsRes.data ?? []).map((u) => ({
      id: u.user_id as string,
      label: `${u.first_name} ${u.last_name} (${u.email})`,
    })),
    locations: (locationsRes.data ?? []).map((l) => ({
      id: l.location_id as string,
      label: `${l.name} (${l.code})`,
    })),
    entityTypes,
  };
}
