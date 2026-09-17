import type { UserRole } from "@/lib/database/types";
import { isFloorTech } from "@/lib/permissions/checks";

export type AssignmentVisibilityFields = {
  primary_technician_id?: string | null;
  quality_check_assigned_to?: string | null;
  /** Used for head_tech safety-stage access. */
  status?: string | null;
  jobs?: Array<{ assigned_technician_id?: string | null }> | null;
};

/** True when the tech is primary, QC assignee, or assigned on any job. */
export function isWorkOrderAssignedToTechnician(
  workOrder: AssignmentVisibilityFields,
  technicianUserId: string
): boolean {
  if (workOrder.primary_technician_id === technicianUserId) return true;
  if (workOrder.quality_check_assigned_to === technicianUserId) return true;
  return (workOrder.jobs ?? []).some(
    (job) => job.assigned_technician_id === technicianUserId
  );
}

/**
 * Floor techs may only open WOs they are assigned to (job / primary / QC).
 * Head tech may also open WOs in the safety_check stage.
 * Front office / admin retain full access.
 */
export function canViewerAccessWorkOrder(
  workOrder: AssignmentVisibilityFields,
  role: UserRole,
  viewerUserId: string
): boolean {
  if (!isFloorTech(role)) return true;
  if (isWorkOrderAssignedToTechnician(workOrder, viewerUserId)) return true;
  if (role === "head_tech" && workOrder.status === "safety_check") return true;
  return false;
}

export function assertViewerCanAccessWorkOrder(
  workOrder: AssignmentVisibilityFields,
  role: UserRole,
  viewerUserId: string
): void {
  if (!canViewerAccessWorkOrder(workOrder, role, viewerUserId)) {
    throw new Error("FORBIDDEN");
  }
}

/**
 * Floor techs only see work orders they are assigned to.
 * Front office / admin see the full location set.
 */
export function scopeWorkOrdersForViewer<T extends AssignmentVisibilityFields>(
  rows: T[],
  role: UserRole,
  viewerUserId: string
): T[] {
  if (!isFloorTech(role)) return rows;
  return rows.filter((row) => isWorkOrderAssignedToTechnician(row, viewerUserId));
}

/**
 * Locations whose assigned work belongs on this technician view.
 * A tech looking at their own floor sees every shop they belong to.
 * Advisors / owners looking at a tech stay on the active shop.
 */
export function floorAssignedLocationIds(input: {
  viewerUserId: string;
  technicianUserId: string;
  activeLocationId: string;
  membershipLocationIds: readonly string[];
}): string[] {
  if (input.viewerUserId === input.technicianUserId) {
    const ids = [...new Set(input.membershipLocationIds.filter(Boolean))];
    return ids.length > 0 ? ids : [input.activeLocationId];
  }
  return [input.activeLocationId];
}

/**
 * Floor techs may open work at any shop they belong to (assignment is a
 * separate check). Front office stays on the cookie / active shop.
 */
export function canViewerAccessWorkOrderLocation(input: {
  role: UserRole;
  workOrderLocationId: string;
  activeLocationId: string | null;
  membershipLocationIds: readonly string[];
}): boolean {
  if (!input.membershipLocationIds.includes(input.workOrderLocationId)) {
    return false;
  }
  if (isFloorTech(input.role)) return true;
  return input.workOrderLocationId === input.activeLocationId;
}

export function assertViewerCanAccessWorkOrderLocation(
  user: {
    role: UserRole;
    active_location_id: string | null;
    location_ids: readonly string[];
  },
  workOrderLocationId: string
): void {
  if (
    !canViewerAccessWorkOrderLocation({
      role: user.role,
      workOrderLocationId,
      activeLocationId: user.active_location_id,
      membershipLocationIds: user.location_ids,
    })
  ) {
    throw new Error("FOREIGN_LOCATION");
  }
}
