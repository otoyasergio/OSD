import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canViewAuditLog } from "@/lib/permissions";
import { toFormErrorMessage } from "@/lib/services/errors";

export type UxEventType = "user_error" | "action_failed" | "friction";

export type UxEvent = {
  event_id: string;
  created_at: string;
  actor_user_id: string | null;
  location_id: string | null;
  role: string | null;
  source: string;
  event_type: UxEventType;
  code: string;
  message: string;
  context: Record<string, unknown>;
  actor?: {
    user_id: string;
    first_name: string;
    last_name: string;
  } | null;
};

export type UxEventFilters = {
  from?: string | null;
  to?: string | null;
  actor_user_id?: string | null;
  event_type?: string | null;
  code?: string | null;
  limit?: number;
};

export async function recordUxEvent(input: {
  event_type: UxEventType;
  code: string;
  message: string;
  source?: string;
  context?: Record<string, unknown>;
  /** When true, surface insert failures instead of swallowing them. */
  throwOnError?: boolean;
}): Promise<void> {
  try {
    const user = await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.from("ux_event").insert({
      actor_user_id: user.user_id,
      location_id: user.active_location_id,
      role: user.role,
      source: input.source?.slice(0, 200) ?? "",
      event_type: input.event_type,
      code: input.code.slice(0, 120),
      message: input.message.slice(0, 500),
      context: input.context ?? {},
    });
    if (error) throw error;
  } catch (error) {
    if (input.throwOnError) throw error;
    // Never block the main user flow on automatic logging failures.
  }
}

/** Record a user-visible failure from a thrown service error. */
export async function recordUxFailure(
  error: unknown,
  input: {
    source: string;
    context?: Record<string, unknown>;
    event_type?: UxEventType;
  }
): Promise<string> {
  const message = toFormErrorMessage(error);
  const code =
    error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "UNKNOWN";
  await recordUxEvent({
    event_type: input.event_type ?? "action_failed",
    code: code.slice(0, 120),
    message,
    source: input.source,
    context: input.context,
  });
  return message;
}

export async function listUxEvents(filters: UxEventFilters = {}): Promise<UxEvent[]> {
  const user = await requireUser();
  if (!canViewAuditLog(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  let query = supabase
    .from("ux_event")
    .select(
      `
      event_id,
      created_at,
      actor_user_id,
      location_id,
      role,
      source,
      event_type,
      code,
      message,
      context,
      actor:actor_user_id (
        user_id,
        first_name,
        last_name
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) {
    const toValue = filters.to.includes("T") ? filters.to : `${filters.to}T23:59:59.999Z`;
    query = query.lte("created_at", toValue);
  }
  if (filters.actor_user_id) query = query.eq("actor_user_id", filters.actor_user_id);
  if (filters.event_type) query = query.eq("event_type", filters.event_type);
  if (filters.code) query = query.ilike("code", `%${filters.code}%`);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const actorRaw = row.actor;
    const actor = Array.isArray(actorRaw) ? actorRaw[0] : actorRaw;
    return {
      event_id: row.event_id,
      created_at: row.created_at,
      actor_user_id: row.actor_user_id,
      location_id: row.location_id,
      role: row.role,
      source: row.source,
      event_type: row.event_type as UxEventType,
      code: row.code,
      message: row.message,
      context: (row.context ?? {}) as Record<string, unknown>,
      actor: actor
        ? {
            user_id: actor.user_id,
            first_name: actor.first_name,
            last_name: actor.last_name,
          }
        : null,
    };
  });
}

export async function summarizeUxCodes(
  events: UxEvent[]
): Promise<Array<{ code: string; count: number }>> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = event.code || "UNKNOWN";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}
