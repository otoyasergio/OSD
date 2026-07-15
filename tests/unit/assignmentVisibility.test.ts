import { describe, expect, it } from "vitest";
import {
  assertViewerCanAccessWorkOrder,
  canViewerAccessWorkOrder,
  isWorkOrderAssignedToTechnician,
  scopeWorkOrdersForViewer,
} from "@/lib/workOrders/assignmentVisibility";

describe("isWorkOrderAssignedToTechnician", () => {
  it("matches primary technician", () => {
    expect(
      isWorkOrderAssignedToTechnician(
        { primary_technician_id: "tech-1", jobs: [] },
        "tech-1"
      )
    ).toBe(true);
  });

  it("matches job assigned technician", () => {
    expect(
      isWorkOrderAssignedToTechnician(
        {
          primary_technician_id: "other",
          jobs: [{ assigned_technician_id: "tech-1" }],
        },
        "tech-1"
      )
    ).toBe(true);
  });

  it("matches quality check assignee", () => {
    expect(
      isWorkOrderAssignedToTechnician(
        {
          primary_technician_id: null,
          quality_check_assigned_to: "tech-1",
          jobs: [],
        },
        "tech-1"
      )
    ).toBe(true);
  });

  it("rejects unassigned work orders", () => {
    expect(
      isWorkOrderAssignedToTechnician(
        {
          primary_technician_id: null,
          quality_check_assigned_to: null,
          jobs: [{ assigned_technician_id: null }],
        },
        "tech-1"
      )
    ).toBe(false);
  });
});

describe("canViewerAccessWorkOrder", () => {
  const unassigned = {
    primary_technician_id: null,
    quality_check_assigned_to: null,
    status: "in_progress" as const,
    jobs: [{ assigned_technician_id: null }],
  };

  it("allows front office and admin on any work order", () => {
    for (const role of ["owner", "manager", "service_advisor", "admin"] as const) {
      expect(canViewerAccessWorkOrder(unassigned, role, "tech-1")).toBe(true);
    }
  });

  it("denies floor techs on unassigned work orders", () => {
    expect(canViewerAccessWorkOrder(unassigned, "technician", "tech-1")).toBe(false);
    expect(canViewerAccessWorkOrder(unassigned, "head_tech", "tech-1")).toBe(false);
  });

  it("allows floor techs when a job is assigned to them", () => {
    expect(
      canViewerAccessWorkOrder(
        {
          ...unassigned,
          jobs: [{ assigned_technician_id: "tech-1" }],
        },
        "technician",
        "tech-1"
      )
    ).toBe(true);
  });

  it("allows floor techs when they are the QC assignee", () => {
    expect(
      canViewerAccessWorkOrder(
        {
          ...unassigned,
          quality_check_assigned_to: "tech-1",
          status: "quality_check",
        },
        "technician",
        "tech-1"
      )
    ).toBe(true);
  });

  it("allows head_tech on safety_check even without job assignment", () => {
    expect(
      canViewerAccessWorkOrder(
        { ...unassigned, status: "safety_check" },
        "head_tech",
        "tech-1"
      )
    ).toBe(true);
    expect(
      canViewerAccessWorkOrder(
        { ...unassigned, status: "safety_check" },
        "technician",
        "tech-1"
      )
    ).toBe(false);
  });
});

describe("assertViewerCanAccessWorkOrder", () => {
  it("throws FORBIDDEN when a floor tech lacks assignment", () => {
    expect(() =>
      assertViewerCanAccessWorkOrder(
        {
          primary_technician_id: null,
          quality_check_assigned_to: null,
          status: "ready_for_technician",
          jobs: [{ assigned_technician_id: null }],
        },
        "technician",
        "tech-1"
      )
    ).toThrow("FORBIDDEN");
  });

  it("does not throw for assigned floor techs", () => {
    expect(() =>
      assertViewerCanAccessWorkOrder(
        {
          primary_technician_id: null,
          quality_check_assigned_to: null,
          status: "in_progress",
          jobs: [{ assigned_technician_id: "tech-1" }],
        },
        "technician",
        "tech-1"
      )
    ).not.toThrow();
  });
});

describe("scopeWorkOrdersForViewer", () => {
  const rows = [
    {
      work_order_id: "a",
      primary_technician_id: "tech-1",
      jobs: [] as Array<{ assigned_technician_id: string | null }>,
    },
    {
      work_order_id: "b",
      primary_technician_id: "tech-2",
      jobs: [{ assigned_technician_id: "tech-2" }],
    },
    {
      work_order_id: "c",
      primary_technician_id: null,
      jobs: [{ assigned_technician_id: null }],
    },
  ];

  it("does not filter for front office roles", () => {
    expect(scopeWorkOrdersForViewer(rows, "owner", "tech-1")).toEqual(rows);
    expect(scopeWorkOrdersForViewer(rows, "manager", "tech-1")).toEqual(rows);
    expect(scopeWorkOrdersForViewer(rows, "service_advisor", "tech-1")).toEqual(rows);
  });

  it("keeps only assigned work orders for floor techs", () => {
    expect(
      scopeWorkOrdersForViewer(rows, "technician", "tech-1").map((r) => r.work_order_id)
    ).toEqual(["a"]);
    expect(
      scopeWorkOrdersForViewer(rows, "head_tech", "tech-2").map((r) => r.work_order_id)
    ).toEqual(["b"]);
  });
});
