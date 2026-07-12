import type { UserRole } from "@/lib/database/types";

const FRONT_OFFICE: UserRole[] = ["owner", "manager", "service_advisor"];
const OWNERS: UserRole[] = ["owner"];
const OWNERS_MANAGERS: UserRole[] = ["owner", "manager"];
const QC_ROLES: UserRole[] = ["owner", "manager", "service_advisor"];

export function canCreateWorkOrder(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}
export function canEditWorkOrder(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canAssignTechnician(role: UserRole) {
  return OWNERS_MANAGERS.includes(role) || role === "service_advisor";
}
export function canRecordCustomerApproval(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canCompleteInspection(role: UserRole) {
  return role === "technician" || FRONT_OFFICE.includes(role);
}
export function canCreateRecommendation(role: UserRole) {
  return role === "technician" || FRONT_OFFICE.includes(role);
}
export function canConvertRecommendation(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canOrderPart(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canViewPartsBoard(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "technician";
}
/** MSRP + dealer cost on catalog/part lines. */
export function canViewPartCost(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}
/** Manual Parts Canada inventory sync (owner/manager). */
export function canSyncPartsCanadaCatalog(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}
/** Push/pull Wix contacts and create Wix invoices from work orders. */
export function canSyncWixContacts(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}
export function canCreateWixInvoice(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canCompleteJob(role: UserRole) {
  return role === "technician" || FRONT_OFFICE.includes(role);
}
export function canRunQualityCheck(role: UserRole) {
  return QC_ROLES.includes(role);
}
export function canMarkReadyForPickup(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canCompleteWorkOrder(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canUpdateServiceInformation(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canManageServiceCatalogue(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}
export function canManageInspectionTemplate(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}
export function canManageUsers(role: UserRole) {
  return OWNERS.includes(role);
}
export function canManageLocations(role: UserRole) {
  return OWNERS.includes(role);
}
export function canViewAuditLog(role: UserRole) {
  return OWNERS.includes(role);
}
export function canOverrideWorkOrderStatus(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}

/** Admin: limited operational help; no workflow override, no audit, no user/location admin. */
export function canAdminHelpCreateRecords(role: UserRole) {
  return role === "admin" || FRONT_OFFICE.includes(role);
}
