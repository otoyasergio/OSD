import { describe, it, expect } from "vitest";
import {
  canRecordCustomerApproval,
  canManageUsers,
  canViewAuditLog,
  canOrderPart,
  canCompleteWorkOrder,
  canRunQualityCheck,
  canManageServiceCatalogue,
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
});
