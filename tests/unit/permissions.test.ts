import { describe, it, expect } from "vitest";
import {
  canRecordCustomerApproval,
  canManageUsers,
  canViewAuditLog,
  canOrderPart,
  canViewPartsBoard,
  canViewPartCost,
  canSyncPartsCanadaCatalog,
  canSyncWixContacts,
  canCompleteWorkOrder,
  canRunQualityCheck,
  canManageServiceCatalogue,
  canManageContractTemplate,
  canUpdateServiceInformation,
  canDeleteIntakePhoto,
  canViewCustomerDocuments,
  canUploadCustomerDocuments,
  canDeleteCustomerDocuments,
  canViewReports,
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
});
