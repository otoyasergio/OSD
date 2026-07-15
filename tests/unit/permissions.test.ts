import { describe, it, expect } from "vitest";
import {
  canRecordCustomerApproval,
  canManageUsers,
  canViewAuditLog,
  canOrderPart,
  canViewPartsBoard,
  canViewPartCost,
  canViewPricing,
  canViewFiledArchive,
  canViewDashboard,
  staffHomePath,
  canSyncPartsCanadaCatalog,
  canSyncWixContacts,
  canCompleteWorkOrder,
  canRunQualityCheck,
  canPullJob,
  canPerformPeerQualityCheck,
  canClearAdminFlag,
  canCreateAdminFlag,
  canManageServiceCatalogue,
  canManageContractTemplate,
  canUpdateServiceInformation,
  canDeleteIntakePhoto,
  canViewClients,
  canViewCustomerDocuments,
  canUploadCustomerDocuments,
  canDeleteCustomerDocuments,
  canViewDropOffAgreement,
  canViewReports,
  canChangeOwnPassword,
  canPerformSafetyCheck,
  canOverrideSafetyRequirement,
  canCompleteInspection,
  canCompleteJob,
  canCreateRecommendation,
  canViewTechnicianDocket,
} from "@/lib/permissions/checks";

describe("permissions", () => {
  it("blocks technician from recording customer approval", () => {
    expect(canRecordCustomerApproval("technician")).toBe(false);
  });

  it("allows service_advisor to record customer approval", () => {
    expect(canRecordCustomerApproval("service_advisor")).toBe(true);
  });

  it("only owner can view audit log", () => {
    expect(canViewAuditLog("owner")).toBe(true);
    expect(canViewAuditLog("manager")).toBe(false);
    expect(canViewAuditLog("technician")).toBe(false);
  });

  it("only owner can manage users", () => {
    expect(canManageUsers("owner")).toBe(true);
    expect(canManageUsers("manager")).toBe(false);
  });

  it("owner and manager can manage service catalogue", () => {
    expect(canManageServiceCatalogue("owner")).toBe(true);
    expect(canManageServiceCatalogue("manager")).toBe(true);
    expect(canManageServiceCatalogue("service_advisor")).toBe(false);
  });

  it("owner and manager can manage contract template", () => {
    expect(canManageContractTemplate("owner")).toBe(true);
    expect(canManageContractTemplate("manager")).toBe(true);
    expect(canManageContractTemplate("service_advisor")).toBe(false);
    expect(canManageContractTemplate("technician")).toBe(false);
  });

  it("technician cannot complete work order", () => {
    expect(canCompleteWorkOrder("technician")).toBe(false);
  });

  it("service_advisor can run quality check", () => {
    expect(canRunQualityCheck("service_advisor")).toBe(true);
    expect(canRunQualityCheck("technician")).toBe(false);
  });

  it("technician cannot self-pull unassigned jobs but can peer QC", () => {
    expect(canPullJob("technician")).toBe(false);
    expect(canPerformPeerQualityCheck("technician")).toBe(true);
    expect(canClearAdminFlag("technician")).toBe(false);
    expect(canClearAdminFlag("service_advisor")).toBe(true);
    expect(canCreateAdminFlag("technician")).toBe(true);
  });

  it("canOrderPart is true for front office roles", () => {
    expect(canOrderPart("service_advisor")).toBe(true);
    expect(canOrderPart("technician")).toBe(false);
  });

  it("canViewPartsBoard allows front office and technicians", () => {
    expect(canViewPartsBoard("owner")).toBe(true);
    expect(canViewPartsBoard("manager")).toBe(true);
    expect(canViewPartsBoard("service_advisor")).toBe(true);
    expect(canViewPartsBoard("technician")).toBe(true);
    expect(canViewPartsBoard("admin")).toBe(false);
  });

  it("canViewPartCost allows front office and admin, not technicians", () => {
    expect(canViewPartCost("owner")).toBe(true);
    expect(canViewPartCost("manager")).toBe(true);
    expect(canViewPartCost("service_advisor")).toBe(true);
    expect(canViewPartCost("admin")).toBe(true);
    expect(canViewPartCost("technician")).toBe(false);
  });

  it("canViewPricing allows front office and admin, not floor techs", () => {
    expect(canViewPricing("owner")).toBe(true);
    expect(canViewPricing("manager")).toBe(true);
    expect(canViewPricing("service_advisor")).toBe(true);
    expect(canViewPricing("admin")).toBe(true);
    expect(canViewPricing("technician")).toBe(false);
    expect(canViewPricing("head_tech")).toBe(false);
  });

  it("canViewFiledArchive is front office only", () => {
    expect(canViewFiledArchive("owner")).toBe(true);
    expect(canViewFiledArchive("manager")).toBe(true);
    expect(canViewFiledArchive("service_advisor")).toBe(true);
    expect(canViewFiledArchive("technician")).toBe(false);
    expect(canViewFiledArchive("head_tech")).toBe(false);
    expect(canViewFiledArchive("admin")).toBe(false);
  });

  it("canViewDashboard is false for floor techs", () => {
    expect(canViewDashboard("technician")).toBe(false);
    expect(canViewDashboard("head_tech")).toBe(false);
    expect(canViewDashboard("owner")).toBe(true);
    expect(canViewDashboard("manager")).toBe(true);
    expect(canViewDashboard("service_advisor")).toBe(true);
    expect(canViewDashboard("admin")).toBe(true);
  });

  it("staffHomePath sends floor techs to the tech floor", () => {
    expect(staffHomePath("technician")).toBe("/technician");
    expect(staffHomePath("head_tech")).toBe("/technician");
    expect(staffHomePath("owner")).toBe("/dashboard");
    expect(staffHomePath("service_advisor")).toBe("/dashboard");
  });

  it("canSyncPartsCanadaCatalog is owner/manager only", () => {
    expect(canSyncPartsCanadaCatalog("owner")).toBe(true);
    expect(canSyncPartsCanadaCatalog("manager")).toBe(true);
    expect(canSyncPartsCanadaCatalog("service_advisor")).toBe(false);
    expect(canSyncPartsCanadaCatalog("technician")).toBe(false);
  });

  it("canSyncWixContacts allows front office and admin", () => {
    expect(canSyncWixContacts("owner")).toBe(true);
    expect(canSyncWixContacts("service_advisor")).toBe(true);
    expect(canSyncWixContacts("admin")).toBe(true);
    expect(canSyncWixContacts("technician")).toBe(false);
  });

  it("front office can update motorcycle service information", () => {
    expect(canUpdateServiceInformation("owner")).toBe(true);
    expect(canUpdateServiceInformation("manager")).toBe(true);
    expect(canUpdateServiceInformation("service_advisor")).toBe(true);
    expect(canUpdateServiceInformation("technician")).toBe(false);
    expect(canUpdateServiceInformation("admin")).toBe(false);
  });

  it("owner and manager can delete intake photos, not advisors or technicians", () => {
    expect(canDeleteIntakePhoto("owner")).toBe(true);
    expect(canDeleteIntakePhoto("manager")).toBe(true);
    expect(canDeleteIntakePhoto("service_advisor")).toBe(false);
    expect(canDeleteIntakePhoto("technician")).toBe(false);
    expect(canDeleteIntakePhoto("admin")).toBe(false);
  });

  it("owner, manager, admin, and service advisor can view clients; technicians cannot", () => {
    for (const role of ["owner", "manager", "admin", "service_advisor"] as const) {
      expect(canViewClients(role)).toBe(true);
    }
    expect(canViewClients("technician")).toBe(false);
  });

  it("owner, manager, admin, and service advisor can view and upload customer documents", () => {
    for (const role of ["owner", "manager", "admin", "service_advisor"] as const) {
      expect(canViewCustomerDocuments(role)).toBe(true);
      expect(canUploadCustomerDocuments(role)).toBe(true);
    }
    expect(canViewCustomerDocuments("technician")).toBe(false);
    expect(canUploadCustomerDocuments("technician")).toBe(false);
  });

  it("only owner and manager can delete customer documents", () => {
    expect(canDeleteCustomerDocuments("owner")).toBe(true);
    expect(canDeleteCustomerDocuments("manager")).toBe(true);
    expect(canDeleteCustomerDocuments("service_advisor")).toBe(false);
    expect(canDeleteCustomerDocuments("admin")).toBe(false);
    expect(canDeleteCustomerDocuments("technician")).toBe(false);
  });

  it("owner and manager can view shop reports", () => {
    expect(canViewReports("owner")).toBe(true);
    expect(canViewReports("manager")).toBe(true);
    expect(canViewReports("service_advisor")).toBe(false);
    expect(canViewReports("technician")).toBe(false);
  });

  it("every active role can change their own password", () => {
    for (const role of [
      "owner",
      "manager",
      "service_advisor",
      "technician",
      "head_tech",
      "admin",
    ] as const) {
      expect(canChangeOwnPassword(role)).toBe(true);
    }
  });

  it("only head_tech can perform safety check", () => {
    expect(canPerformSafetyCheck("head_tech")).toBe(true);
    expect(canPerformSafetyCheck("technician")).toBe(false);
    expect(canPerformSafetyCheck("service_advisor")).toBe(false);
    expect(canPerformSafetyCheck("manager")).toBe(false);
    expect(canPerformSafetyCheck("owner")).toBe(false);
    expect(canPerformSafetyCheck("admin")).toBe(false);
  });

  it("front office can override safety requirement", () => {
    expect(canOverrideSafetyRequirement("owner")).toBe(true);
    expect(canOverrideSafetyRequirement("manager")).toBe(true);
    expect(canOverrideSafetyRequirement("service_advisor")).toBe(true);
    expect(canOverrideSafetyRequirement("head_tech")).toBe(false);
    expect(canOverrideSafetyRequirement("technician")).toBe(false);
    expect(canOverrideSafetyRequirement("admin")).toBe(false);
  });

  it("blocks floor techs from viewing signed drop-off agreements (PII / legal)", () => {
    // Signed agreement is PII / legal — floor techs excluded.
    expect(canViewDropOffAgreement("technician")).toBe(false);
    expect(canViewDropOffAgreement("head_tech")).toBe(false);
    expect(canViewDropOffAgreement("service_advisor")).toBe(true);
    expect(canViewDropOffAgreement("manager")).toBe(true);
    expect(canViewDropOffAgreement("owner")).toBe(true);
    expect(canViewDropOffAgreement("admin")).toBe(true);
  });

  it("head_tech inherits technician floor permissions without client CRM", () => {
    expect(canPullJob("head_tech")).toBe(false);
    expect(canPerformPeerQualityCheck("head_tech")).toBe(true);
    expect(canCompleteJob("head_tech")).toBe(true);
    expect(canCompleteInspection("head_tech")).toBe(true);
    expect(canCreateRecommendation("head_tech")).toBe(true);
    expect(canViewPartsBoard("head_tech")).toBe(true);
    expect(canCreateAdminFlag("head_tech")).toBe(true);
    expect(canViewClients("head_tech")).toBe(false);
    expect(canRunQualityCheck("head_tech")).toBe(false);
    expect(canRecordCustomerApproval("head_tech")).toBe(false);
  });

  it("front office can view any tech docket; floor techs only their own", () => {
    expect(canViewTechnicianDocket("owner", "tech-a", "tech-b")).toBe(true);
    expect(canViewTechnicianDocket("manager", "tech-a", "tech-b")).toBe(true);
    expect(canViewTechnicianDocket("service_advisor", "tech-a", "tech-b")).toBe(true);
    expect(canViewTechnicianDocket("technician", "tech-a", "tech-a")).toBe(true);
    expect(canViewTechnicianDocket("technician", "tech-a", "tech-b")).toBe(false);
    expect(canViewTechnicianDocket("head_tech", "tech-a", "tech-a")).toBe(true);
    expect(canViewTechnicianDocket("head_tech", "tech-a", "tech-b")).toBe(false);
    expect(canViewTechnicianDocket("admin", "tech-a", "tech-b")).toBe(false);
  });
});
