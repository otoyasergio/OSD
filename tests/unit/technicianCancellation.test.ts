import { describe, expect, it } from "vitest";
import {
  buildTechnicianDocketItems,
  filterActiveAssignedJobs,
  filterActiveDocketFlags,
  type DocketAssignedJobInput,
  type DocketFlagInput,
} from "@/lib/services/technicianDocket";
import {
  mapUnreadStaffNotifications,
  type StaffNotificationRow,
} from "@/lib/services/staffNotifications";
import {
  buildFloorActionModel,
  deriveFloorWorkState,
  isTerminalJobStatus,
  isTerminalWorkOrderStatus,
} from "@/lib/technician/floorActionModel";

function assignedJob(
  overrides: Partial<DocketAssignedJobInput> = {}
): DocketAssignedJobInput {
  return {
    job_id: "j1",
    work_order_id: "w1",
    work_order_number: "WO-1",
    service_name: "Oil change",
    motorcycle_label: "Yamaha R3",
    status: "in_progress",
    status_label: "In Progress",
    work_order_status: "in_progress",
    ...overrides,
  };
}

function flag(overrides: Partial<DocketFlagInput> = {}): DocketFlagInput {
  return {
    admin_flag_id: "f1",
    work_order_id: "w9",
    work_order_number: "WO-9",
    work_order_status: "in_progress",
    job_id: null,
    motorcycle_label: "Ducati Monster",
    reason: "parts",
    note: null,
    ...overrides,
  };
}

function notificationRow(
  overrides: Partial<StaffNotificationRow> & {
    workOrderStatus?: string | null;
  } = {}
): StaffNotificationRow {
  const { workOrderStatus = "in_progress", ...rest } = overrides;
  return {
    staff_notification_id: "n1",
    kind: "work_order_assigned",
    work_order_id: "w1",
    created_at: "2026-07-17T12:00:00Z",
    actor: { first_name: "Alex", last_name: "Advisor" },
    work_order: {
      work_order_id: "w1",
      work_order_number: "WO-1042",
      status: workOrderStatus,
      motorcycle: { year: 2024, make: "Honda", model: "CB650R" },
    },
    ...rest,
  };
}

describe("terminal work orders stay off the floor", () => {
  it("classifies terminal statuses", () => {
    expect(isTerminalWorkOrderStatus("completed")).toBe(true);
    expect(isTerminalWorkOrderStatus("cancelled")).toBe(true);
    expect(isTerminalWorkOrderStatus("on_hold")).toBe(false);
    expect(isTerminalWorkOrderStatus("in_progress")).toBe(false);
    expect(isTerminalWorkOrderStatus(null)).toBe(false);

    expect(isTerminalJobStatus("cancelled")).toBe(true);
    expect(isTerminalJobStatus("declined")).toBe(true);
    expect(isTerminalJobStatus("in_progress")).toBe(false);
  });

  it("filters assigned jobs on cancelled/completed work orders", () => {
    const kept = assignedJob();
    const filtered = filterActiveAssignedJobs([
      kept,
      assignedJob({ job_id: "j2", work_order_status: "cancelled" }),
      assignedJob({ job_id: "j3", work_order_status: "completed" }),
      assignedJob({ job_id: "j4", status: "cancelled" }),
      assignedJob({ job_id: "j5", status: "declined" }),
    ]);
    expect(filtered).toEqual([kept]);
  });

  it("filters uncleared flags whose work order is closed", () => {
    const kept = flag();
    const filtered = filterActiveDocketFlags([
      kept,
      flag({ admin_flag_id: "f2", work_order_status: "cancelled" }),
      flag({ admin_flag_id: "f3", work_order_status: "completed" }),
    ]);
    expect(filtered).toEqual([kept]);
    // Held bikes keep their flags — a hold is not terminal.
    expect(
      filterActiveDocketFlags([flag({ work_order_status: "on_hold" })])
    ).toHaveLength(1);
  });

  it("keeps cancelled work orders out of the built docket entirely", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        assignedJob(),
        assignedJob({
          job_id: "j2",
          work_order_id: "w2",
          work_order_number: "WO-2",
          work_order_status: "cancelled",
        }),
      ],
      qcItems: [],
      safetyItems: [],
      flags: [
        flag({ work_order_status: "cancelled" }),
        flag({
          admin_flag_id: "f-live",
          work_order_id: "w8",
          work_order_number: "WO-8",
          work_order_status: "in_progress",
        }),
      ],
      includeSafeties: false,
    });
    const workOrderIds = items.map((item) => item.work_order_id);
    expect(workOrderIds).toContain("w1");
    expect(workOrderIds).toContain("w8");
    expect(workOrderIds).not.toContain("w2");
    expect(workOrderIds).not.toContain("w9");
  });

  it("drops assignment notifications for cancelled/completed work orders", () => {
    const mapped = mapUnreadStaffNotifications([
      notificationRow(),
      notificationRow({
        staff_notification_id: "n2",
        workOrderStatus: "cancelled",
      }),
      notificationRow({
        staff_notification_id: "n3",
        workOrderStatus: "completed",
      }),
      notificationRow({ staff_notification_id: "n4", work_order: null }),
    ]);
    expect(mapped.map((notification) => notification.notification_id)).toEqual(["n1"]);
    expect(mapped[0]).toMatchObject({
      work_order_number: "WO-1042",
      motorcycle_label: "2024 Honda CB650R",
    });
  });

  it("keeps notifications without a status column (legacy rows) visible", () => {
    const mapped = mapUnreadStaffNotifications([
      notificationRow({ workOrderStatus: null }),
    ]);
    expect(mapped).toHaveLength(1);
  });

  it("resolves a direct selection of a terminal work order to no work", () => {
    // Pure core of the service guard: the floor rejects the selection and the
    // page falls back to the empty "Pick a bike" state.
    for (const woStatus of ["completed", "cancelled"] as const) {
      const state = deriveFloorWorkState({
        job_status: "in_progress",
        work_order_status: woStatus,
        floor_acknowledged_at: "2026-07-17T12:00:00Z",
        floor_parked_at: null,
        floor_park_reason: null,
        job_timer_running: true,
      });
      expect(state.board).toBe("terminal");

      const model = buildFloorActionModel({
        surface: "job",
        job_status: "in_progress",
        work_order_status: woStatus,
        floor_acknowledged_at: "2026-07-17T12:00:00Z",
        floor_parked_at: null,
        floor_park_reason: null,
        job_timer_running: true,
        steps: [],
        complete_gate_ok: false,
      });
      expect(model.primary.enabled).toBe(false);
      expect(model.secondary).toEqual([]);
      expect(model.waitReason).toBeTruthy();
    }
  });
});
