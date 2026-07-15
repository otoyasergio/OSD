import type { UserRole } from "@/lib/database/types";

const FRONT_OFFICE: UserRole[] = ["owner", "manager", "service_advisor"];
const OWNERS: UserRole[] = ["owner"];
const OWNERS_MANAGERS: UserRole[] = ["owner", "manager"];
const QC_ROLES: UserRole[] = ["owner", "manager", "service_advisor"];
/** Floor techs: regular technician + head tech (same shop-floor powers). */
const FLOOR_TECH: UserRole[] = ["technician", "head_tech"];

export function isFloorTech(role: UserRole) {
  return FLOOR_TECH.includes(role);
}

export function canCreateWorkOrder(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}
export function canEditWorkOrder(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canAssignTechnician(role: UserRole) {
  return OWNERS_MANAGERS.includes(role) || role === "service_advisor";
}
/** View a technician's ordered job-load docket (self if floor tech; any tech if assigner). */
export function canViewTechnicianDocket(
  role: UserRole,
  viewerUserId: string,
  technicianUserId: string
) {
  if (canAssignTechnician(role)) return true;
  if (isFloorTech(role)) return viewerUserId === technicianUserId;
  return false;
}
export function canRecordCustomerApproval(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canCompleteInspection(role: UserRole) {
  return isFloorTech(role) || FRONT_OFFICE.includes(role);
}
export function canCreateRecommendation(role: UserRole) {
  return isFloorTech(role) || FRONT_OFFICE.includes(role);
}
export function canConvertRecommendation(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canOrderPart(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canViewPartsBoard(role: UserRole) {
  return FRONT_OFFICE.includes(role) || isFloorTech(role);
}
/** MSRP + dealer cost on catalog/part lines. */
export function canViewPartCost(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}
/** Job sell prices, part MSRP/sell price, invoice totals — not for floor techs. */
export function canViewPricing(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}
/** Complete and filed archive (/complete) — front office only. */
export function canViewFiledArchive(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
/** Shop-floor dashboard board — front office (+ admin); floor techs use /technician. */
export function canViewDashboard(role: UserRole) {
  return !isFloorTech(role);
}
/** Post-login / home redirect target by role. */
export function staffHomePath(role: UserRole) {
  return isFloorTech(role) ? "/technician" : "/dashboard";
}
/** Manual Parts Canada inventory sync (owner/manager). */
export function canSyncPartsCanadaCatalog(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}
/** Push/pull Wix contacts (front office + admin). Billing stays on Square. */
export function canSyncWixContacts(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}
export function canCompleteJob(role: UserRole) {
  return isFloorTech(role) || FRONT_OFFICE.includes(role);
}
export function canRunQualityCheck(role: UserRole) {
  return QC_ROLES.includes(role);
}
/** Floor techs may run peer QC when assigned (enforced in service). */
export function canPerformPeerQualityCheck(role: UserRole) {
  return isFloorTech(role) || QC_ROLES.includes(role);
}
/** Self-pull of unassigned jobs is disabled; advisors assign techs instead. */
export function canPullJob(_role: UserRole) {
  return false;
}
/** Front office clears admin andon flags. */
export function canClearAdminFlag(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
/** Any staff who can complete jobs may raise an admin flag. */
export function canCreateAdminFlag(role: UserRole) {
  return isFloorTech(role) || FRONT_OFFICE.includes(role);
}
/** Only head tech may pass/fail the post-QC safety stage. */
export function canPerformSafetyCheck(role: UserRole) {
  return role === "head_tech";
}
/** Front office may force or waive the safety requirement on a work order. */
export function canOverrideSafetyRequirement(role: UserRole) {
  return FRONT_OFFICE.includes(role);
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
export function canManageContractTemplate(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}
export function canManageShopClosures(role: UserRole) {
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

/** Shop reporting dashboard (owner/manager). */
export function canViewReports(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}

/** Owner/manager timesheets: view, correct punches, export CSV. */
export function canManageTimesheets(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}
export function canOverrideWorkOrderStatus(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}

/** Remove intake / inspection photos from a work order (corrective). */
export function canDeleteIntakePhoto(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}

/** View client CRM (customers + motorcycles directory) and customer PII. */
export function canViewClients(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}

/** View customer profile documents (owner/manager/admin/service advisor). */
export function canViewCustomerDocuments(role: UserRole) {
  return canViewClients(role);
}

/** Upload documents to a customer profile. */
export function canUploadCustomerDocuments(role: UserRole) {
  return canViewCustomerDocuments(role);
}

/** Delete customer profile documents (owner/manager only). */
export function canDeleteCustomerDocuments(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}

/** Billing area (/billing) — front office only; technicians excluded. */
export function canViewBillingArea(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canViewBillingMoneyDesk(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}
export function canViewBillingLedger(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}

export type BillingTab = "collections" | "money_desk" | "ledger";

export function defaultBillingTab(role: UserRole): BillingTab {
  if (role === "owner") return "ledger";
  if (role === "manager") return "money_desk";
  return "collections";
}

export function canViewBillingTab(role: UserRole, tab: BillingTab): boolean {
  if (!canViewBillingArea(role)) return false;
  if (tab === "collections") return true;
  if (tab === "money_desk") return canViewBillingMoneyDesk(role);
  if (tab === "ledger") return canViewBillingLedger(role);
  return false;
}

/** Admin: limited operational help; no workflow override, no audit, no user/location admin. */
export function canAdminHelpCreateRecords(role: UserRole) {
  return role === "admin" || FRONT_OFFICE.includes(role);
}

const ACTIVE_STAFF_ROLES: UserRole[] = [
  "owner",
  "manager",
  "service_advisor",
  "technician",
  "head_tech",
  "admin",
];

/** Company messenger — every active role can use it. */
export function canUseMessenger(role: UserRole) {
  return ACTIVE_STAFF_ROLES.includes(role);
}

/** Self-service password change in Settings — every active role. */
export function canChangeOwnPassword(role: UserRole) {
  return ACTIVE_STAFF_ROLES.includes(role);
}

/** Add/remove group members: the creator, or an owner/manager. */
export function canManageGroupMembers(role: UserRole, isCreator: boolean) {
  return isCreator || OWNERS_MANAGERS.includes(role);
}
