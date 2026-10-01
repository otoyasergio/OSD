import { describe, expect, it } from "vitest";
import {
  decideIntakePhotoObjectAccess,
  decideIntakePhotoRowAccess,
  workOrderIdFromIntakePhotoObjectPath,
} from "@/lib/photos/intakePhotoAccessPolicy";

const WO = "41111111-1111-4111-8111-111111111111";

describe("workOrderIdFromIntakePhotoObjectPath", () => {
  it("reads a valid first-segment work order id", () => {
    expect(workOrderIdFromIntakePhotoObjectPath(`${WO}/front/${WO}.jpg`)).toBe(WO);
    expect(workOrderIdFromIntakePhotoObjectPath(WO.toUpperCase())).toBe(WO);
  });

  it("fails closed on malformed paths without throwing", () => {
    const malformed = [
      "",
      "   ",
      "not-a-uuid/front/photo.jpg",
      "../../../etc/passwd",
      "intake-photos/front/photo.jpg",
      `${WO}extra/front/photo.jpg`,
      "41111111-1111-4111-8111-11111111111g/front/x.jpg",
      null,
      undefined,
    ];
    for (const path of malformed) {
      expect(() => workOrderIdFromIntakePhotoObjectPath(path)).not.toThrow();
      expect(workOrderIdFromIntakePhotoObjectPath(path)).toBeNull();
    }
  });
});

describe("intake photo row policy truth table", () => {
  it("lets assigned staff select and insert, never update, and never delete unless owner/manager in-location", () => {
    const assignedTech = {
      active: true,
      role: "technician",
      workOrderInUserLocations: true,
    };
    const assignedAdvisor = {
      active: true,
      role: "service_advisor",
      workOrderInUserLocations: true,
    };
    const assignedOwner = {
      active: true,
      role: "owner",
      workOrderInUserLocations: true,
    };
    const assignedManager = {
      active: true,
      role: "manager",
      workOrderInUserLocations: true,
    };
    const foreignOwner = {
      active: true,
      role: "owner",
      workOrderInUserLocations: false,
    };

    expect(decideIntakePhotoRowAccess("select", assignedTech)).toBe(true);
    expect(decideIntakePhotoRowAccess("insert", assignedTech)).toBe(true);
    expect(decideIntakePhotoRowAccess("delete", assignedTech)).toBe(false);
    expect(decideIntakePhotoRowAccess("update", assignedTech)).toBe(false);

    expect(decideIntakePhotoRowAccess("select", assignedAdvisor)).toBe(true);
    expect(decideIntakePhotoRowAccess("insert", assignedAdvisor)).toBe(true);
    expect(decideIntakePhotoRowAccess("delete", assignedAdvisor)).toBe(false);
    expect(decideIntakePhotoRowAccess("update", assignedAdvisor)).toBe(false);

    expect(decideIntakePhotoRowAccess("delete", assignedOwner)).toBe(true);
    expect(decideIntakePhotoRowAccess("delete", assignedManager)).toBe(true);
    expect(decideIntakePhotoRowAccess("update", assignedOwner)).toBe(false);

    expect(decideIntakePhotoRowAccess("select", foreignOwner)).toBe(false);
    expect(decideIntakePhotoRowAccess("insert", foreignOwner)).toBe(false);
    expect(decideIntakePhotoRowAccess("delete", foreignOwner)).toBe(false);
  });

  it("denies inactive users even in an assigned location", () => {
    expect(
      decideIntakePhotoRowAccess("select", {
        active: false,
        role: "owner",
        workOrderInUserLocations: true,
      })
    ).toBe(false);
  });
});

describe("intake photo object policy truth table", () => {
  const assignedPath = `${WO}/front/photo.jpg`;

  it("lets assigned staff select and insert, forbids object update, and limits delete to in-location owners/managers", () => {
    expect(
      decideIntakePhotoObjectAccess("select", {
        active: true,
        role: "technician",
        workOrderInUserLocations: true,
        objectPath: assignedPath,
      })
    ).toBe(true);
    expect(
      decideIntakePhotoObjectAccess("insert", {
        active: true,
        role: "service_advisor",
        workOrderInUserLocations: true,
        objectPath: assignedPath,
      })
    ).toBe(true);
    expect(
      decideIntakePhotoObjectAccess("delete", {
        active: true,
        role: "technician",
        workOrderInUserLocations: true,
        objectPath: assignedPath,
      })
    ).toBe(false);
    expect(
      decideIntakePhotoObjectAccess("update", {
        active: true,
        role: "owner",
        workOrderInUserLocations: true,
        objectPath: assignedPath,
      })
    ).toBe(false);
    expect(
      decideIntakePhotoObjectAccess("delete", {
        active: true,
        role: "manager",
        workOrderInUserLocations: true,
        objectPath: assignedPath,
      })
    ).toBe(true);
    expect(
      decideIntakePhotoObjectAccess("delete", {
        active: true,
        role: "owner",
        workOrderInUserLocations: false,
        objectPath: assignedPath,
      })
    ).toBe(false);
  });

  it("fails closed for malformed object paths without a UUID cast exception", () => {
    expect(() =>
      decideIntakePhotoObjectAccess("select", {
        active: true,
        role: "technician",
        workOrderInUserLocations: true,
        objectPath: "not-a-uuid/front/photo.jpg",
      })
    ).not.toThrow();
    expect(
      decideIntakePhotoObjectAccess("select", {
        active: true,
        role: "technician",
        workOrderInUserLocations: true,
        objectPath: "not-a-uuid/front/photo.jpg",
      })
    ).toBe(false);
    expect(
      decideIntakePhotoObjectAccess("insert", {
        active: true,
        role: "owner",
        workOrderInUserLocations: true,
        objectPath: "../secret",
      })
    ).toBe(false);
  });
});
