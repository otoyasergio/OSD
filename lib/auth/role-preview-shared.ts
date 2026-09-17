import type { UserRole } from "@/lib/database/types";
import { canAssignTechnician } from "@/lib/permissions/checks";

/**
 * Roles the owner can preview. "Tech" maps to technician only — head tech
 * carries safety powers that a preview must never imply.
 */
export const ROLE_PREVIEW_ROLES = [
  "owner",
  "service_advisor",
  "admin",
  "technician",
] as const;

export type RolePreviewRole = (typeof ROLE_PREVIEW_ROLES)[number];

export const ROLE_PREVIEW_ROLE_COOKIE = "otomoto_role_preview_role";
export const ROLE_PREVIEW_TECHNICIAN_COOKIE = "otomoto_role_preview_technician_id";

export function isRolePreviewRole(value: unknown): value is RolePreviewRole {
  return (
    typeof value === "string" && (ROLE_PREVIEW_ROLES as readonly string[]).includes(value)
  );
}

export type RolePreviewSelection =
  | { role: Exclude<RolePreviewRole, "owner" | "technician">; technicianId: null }
  | { role: "technician"; technicianId: string };

/**
 * Pure cookie interpretation. Returns null (no preview) unless the persisted
 * role is owner and the cookie names a non-owner preview role. Technician
 * preview additionally requires a technician id; database eligibility is
 * verified by the server resolver on every request.
 */
export function resolveRolePreviewSelection(input: {
  actorRole: UserRole;
  cookieRole: string | null | undefined;
  cookieTechnicianId: string | null | undefined;
}): RolePreviewSelection | null {
  if (input.actorRole !== "owner") return null;
  const role = input.cookieRole;
  if (!isRolePreviewRole(role) || role === "owner") return null;
  if (role === "technician") {
    const technicianId = input.cookieTechnicianId?.trim();
    if (!technicianId) return null;
    return { role, technicianId };
  }
  return { role, technicianId: null };
}

export type PreviewTechnician = {
  user_id: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  status: string;
  at_active_location: boolean;
};

/** Only an active, location-assigned regular technician can be mirrored. */
export function isEligiblePreviewTechnician(
  tech: PreviewTechnician | null | undefined
): tech is PreviewTechnician {
  return (
    !!tech &&
    tech.status === "active" &&
    tech.role === "technician" &&
    tech.at_active_location
  );
}

/** Presentation principal for read services: role + subject id, never actor. */
export type ReadView = {
  role: UserRole;
  subjectUserId: string;
};

export type ReadSubject = {
  role: UserRole;
  userId: string;
};

/**
 * Resolve the read subject a role-shaped read service should mirror.
 * Falls back to the actor whenever the actor may not inspect another
 * user's load. Mutations must never consume this — they stay on the actor.
 */
export function resolveReadSubject(
  actor: { role: UserRole; user_id: string },
  view?: ReadView | null
): ReadSubject {
  if (!view) return { role: actor.role, userId: actor.user_id };
  if (view.subjectUserId !== actor.user_id && !canAssignTechnician(actor.role)) {
    return { role: actor.role, userId: actor.user_id };
  }
  return { role: view.role, userId: view.subjectUserId };
}
