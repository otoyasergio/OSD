const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IntakePhotoAccessAction = "select" | "insert" | "update" | "delete";

export type IntakePhotoAccessContext = {
  active: boolean;
  role: string;
  workOrderInUserLocations: boolean;
  objectPath?: string | null;
};

function isOwnerOrManager(role: string): boolean {
  return role === "owner" || role === "manager";
}

export function workOrderIdFromIntakePhotoObjectPath(
  path: string | null | undefined
): string | null {
  if (path == null) return null;
  const segment = path.trim().split("/")[0] ?? "";
  if (!UUID_SEGMENT.test(segment)) return null;
  return segment.toLowerCase();
}

function canReadOrWrite(ctx: IntakePhotoAccessContext): boolean {
  return ctx.active && ctx.workOrderInUserLocations;
}

function canCorrectivelyDelete(ctx: IntakePhotoAccessContext): boolean {
  return canReadOrWrite(ctx) && isOwnerOrManager(ctx.role);
}

export function decideIntakePhotoRowAccess(
  action: IntakePhotoAccessAction,
  ctx: IntakePhotoAccessContext
): boolean {
  if (action === "update") return false;
  if (action === "delete") return canCorrectivelyDelete(ctx);
  return canReadOrWrite(ctx);
}

export function decideIntakePhotoObjectAccess(
  action: IntakePhotoAccessAction,
  ctx: IntakePhotoAccessContext
): boolean {
  if (action === "update") return false;
  if (workOrderIdFromIntakePhotoObjectPath(ctx.objectPath) == null) return false;
  if (action === "delete") return canCorrectivelyDelete(ctx);
  return canReadOrWrite(ctx);
}
