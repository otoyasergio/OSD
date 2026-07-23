import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/database/supabase-server";
import { getCurrentAppUser, type AppUser } from "@/lib/auth/session";
import type { UserRole } from "@/lib/database/types";
import {
  isEligiblePreviewTechnician,
  resolveRolePreviewSelection,
  ROLE_PREVIEW_ROLE_COOKIE,
  ROLE_PREVIEW_TECHNICIAN_COOKIE,
  type PreviewTechnician,
} from "@/lib/auth/role-preview-shared";

export type RolePreviewContext = {
  /** Authenticated user — the only authorization, mutation, and audit identity. */
  actor: AppUser;
  /** Effective presentation role for navigation, route guards, and read shaping. */
  role: UserRole;
  /** Read-subject id — differs from the actor only in technician preview. */
  subjectUserId: string;
  /** Mirrored technician's display name; null outside technician preview. */
  subjectLabel: string | null;
  isPreviewing: boolean;
};

function asActor(actor: AppUser): RolePreviewContext {
  return {
    actor,
    role: actor.role,
    subjectUserId: actor.user_id,
    subjectLabel: null,
    isPreviewing: false,
  };
}

async function loadPreviewTechnician(
  technicianId: string,
  activeLocationId: string | null
): Promise<PreviewTechnician | null> {
  if (!activeLocationId) return null;
  const supabase = await createClient();
  const [{ data: tech }, { data: membership }] = await Promise.all([
    supabase
      .from("app_user")
      .select("user_id, first_name, last_name, role, status")
      .eq("user_id", technicianId)
      .maybeSingle(),
    supabase
      .from("user_location")
      .select("user_id")
      .eq("user_id", technicianId)
      .eq("location_id", activeLocationId)
      .maybeSingle(),
  ]);
  if (!tech) return null;
  return {
    user_id: tech.user_id,
    first_name: tech.first_name,
    last_name: tech.last_name,
    role: tech.role as UserRole,
    status: tech.status as string,
    at_active_location: Boolean(membership),
  };
}

/**
 * Owner-only "view as" context. Preview cookies are honored only when the
 * persisted role is owner; forged, stale, cross-location, or unsupported
 * values fall back to the actual identity. Deduped per React request.
 */
export const getRolePreviewContext = cache(
  async (): Promise<RolePreviewContext | null> => {
    const actor = await getCurrentAppUser();
    if (!actor) return null;

    const cookieStore = await cookies();
    const selection = resolveRolePreviewSelection({
      actorRole: actor.role,
      cookieRole: cookieStore.get(ROLE_PREVIEW_ROLE_COOKIE)?.value ?? null,
      cookieTechnicianId: cookieStore.get(ROLE_PREVIEW_TECHNICIAN_COOKIE)?.value ?? null,
    });
    if (!selection) return asActor(actor);

    if (selection.role !== "technician") {
      return {
        actor,
        role: selection.role,
        subjectUserId: actor.user_id,
        subjectLabel: null,
        isPreviewing: true,
      };
    }

    const technician = await loadPreviewTechnician(
      selection.technicianId,
      actor.active_location_id
    );
    if (!isEligiblePreviewTechnician(technician)) return asActor(actor);

    return {
      actor,
      role: "technician",
      subjectUserId: technician.user_id,
      subjectLabel: `${technician.first_name} ${technician.last_name}`.trim(),
      isPreviewing: true,
    };
  }
);

export type RolePreviewTechnicianOption = {
  user_id: string;
  first_name: string;
  last_name: string;
};

/** Active regular technicians at the owner's active location (preview targets). */
export async function listRolePreviewTechnicians(): Promise<
  RolePreviewTechnicianOption[]
> {
  const actor = await getCurrentAppUser();
  if (!actor || actor.role !== "owner" || !actor.active_location_id) return [];

  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("user_location")
    .select("user_id")
    .eq("location_id", actor.active_location_id);
  const memberIds = (memberships ?? []).map((row: { user_id: string }) => row.user_id);
  if (memberIds.length === 0) return [];

  const { data } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name")
    .eq("role", "technician")
    .eq("status", "active")
    .in("user_id", memberIds)
    .order("first_name")
    .order("last_name");
  return (data ?? []) as RolePreviewTechnicianOption[];
}

/** Server-side eligibility check used by the preview setter action. */
export async function findEligiblePreviewTechnician(
  technicianId: string,
  activeLocationId: string | null
): Promise<PreviewTechnician | null> {
  if (!technicianId) return null;
  const technician = await loadPreviewTechnician(technicianId, activeLocationId);
  return isEligiblePreviewTechnician(technician) ? technician : null;
}
