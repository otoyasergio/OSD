import { describe, expect, it } from "vitest";
import { buildTechnicianDocketItems } from "@/lib/services/technicianDocket";
import {
  docketCardAccessibleName,
  docketCardJobLine,
  stampDisplayLabel,
} from "@/lib/technician/docketCardDisplay";
import { splitDocketByWait } from "@/lib/technician/floorActionModel";

describe("docketCardJobLine", () => {
  it("formats WO · service for active jobs", () => {
    expect(
      docketCardJobLine({
        subtitle: "WO-1209",
        service_label: "Annual safety inspection",
        board_stamp: "NEXT",
        park_reason_label: "",
      })
    ).toBe("WO-1209 · Annual safety inspection");
  });

  it("shows park reason on HOLD rows instead of service", () => {
    expect(
      docketCardJobLine({
        subtitle: "WO-1198",
        service_label: "Front brake pads",
        board_stamp: "HOLD",
        park_reason_label: "Parts not here",
      })
    ).toBe("WO-1198 · Parts not here");
  });
});

describe("buildTechnicianDocketItems", () => {
  it("orders NOW first, then assigned, QC, safety, flags", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j2",
          work_order_id: "w2",
          work_order_number: "WO-2",
          service_name: "Oil",
          motorcycle_label: "Honda CBR",
          status: "approved",
          status_label: "Approved",
        },
        {
          job_id: "j1",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Brakes",
          motorcycle_label: "Yamaha R3",
          status: "in_progress",
          status_label: "In Progress",
        },
      ],
      qcItems: [
        {
          work_order_id: "w3",
          work_order_number: "WO-3",
          motorcycle_label: "Kawasaki Z",
        },
      ],
      safetyItems: [
        {
          work_order_id: "w4",
          work_order_number: "WO-4",
          motorcycle_label: "Suzuki GSX",
        },
      ],
      flags: [
        {
          admin_flag_id: "f1",
          work_order_id: "w5",
          work_order_number: "WO-5",
          job_id: null,
          motorcycle_label: "Ducati",
          reason: "parts",
          note: "Need pad",
        },
      ],
      includeSafeties: true,
    });

    expect(items.map((item) => item.kind)).toEqual([
      "now",
      "assigned",
      "qc",
      "safety",
      "flag",
    ]);
    expect(items.map((item) => item.position)).toEqual([1, 2, 3, 4, 5]);
    expect(items[0].job_id).toBe("j1");
    expect(items[0].motorcycle_label).toBe("Yamaha R3");
    expect(items[0].service_label).toBe("Brakes");
    expect(items[0].href).toContain("job=j1");
    expect(items[0].href).toContain("wo=w1");
    expect(docketCardJobLine(items[0])).toBe("WO-1 · Brakes");
  });

  it("omits safeties when includeSafeties is false", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [],
      qcItems: [],
      safetyItems: [
        {
          work_order_id: "w4",
          work_order_number: "WO-4",
          motorcycle_label: "Suzuki GSX",
        },
      ],
      flags: [],
      includeSafeties: false,
    });
    expect(items).toEqual([]);
  });

  it("groups every assigned service for one motorcycle into one docket entry", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j-oil",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Oil change",
          motorcycle_label: "2024 Honda CB650R",
          status: "approved",
          status_label: "Approved",
          docket_position: 1,
        },
        {
          job_id: "j-diagnostics",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Diagnostics",
          motorcycle_label: "2024 Honda CB650R",
          status: "in_progress",
          status_label: "In Progress",
          docket_position: 2,
        },
      ],
      qcItems: [],
      safetyItems: [],
      flags: [
        {
          admin_flag_id: "flag-1",
          work_order_id: "w1",
          work_order_number: "WO-1",
          job_id: "j-diagnostics",
          motorcycle_label: "2024 Honda CB650R",
          reason: "parts",
          note: "Waiting for sensor",
        },
      ],
      includeSafeties: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "work-order-w1",
      kind: "now",
      job_id: "j-diagnostics",
      service_label: "Oil change · Diagnostics",
      status_label: "2 services · In Progress · Flagged",
    });
    expect(items[0].href).toContain("job=j-diagnostics");
  });

  it("orders assigned jobs by advisor-set docket position, unpositioned last", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j-unpositioned",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Chain",
          motorcycle_label: "KTM Duke",
          status: "approved",
          status_label: "Approved",
        },
        {
          job_id: "j-second",
          work_order_id: "w2",
          work_order_number: "WO-2",
          service_name: "Oil",
          motorcycle_label: "Honda CBR",
          status: "approved",
          status_label: "Approved",
          docket_position: 2,
        },
        {
          job_id: "j-first",
          work_order_id: "w3",
          work_order_number: "WO-3",
          service_name: "Brakes",
          motorcycle_label: "Yamaha R3",
          status: "approved",
          status_label: "Approved",
          docket_position: 1,
        },
      ],
      qcItems: [],
      safetyItems: [],
      flags: [],
      includeSafeties: false,
    });

    expect(items.map((item) => item.job_id)).toEqual([
      "j-first",
      "j-second",
      "j-unpositioned",
    ]);
    expect(items.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it("keeps docket order within NOW and queued groups", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j-queued-first",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Chain",
          motorcycle_label: "KTM Duke",
          status: "approved",
          status_label: "Approved",
          docket_position: 2,
        },
        {
          job_id: "j-now",
          work_order_id: "w2",
          work_order_number: "WO-2",
          service_name: "Oil",
          motorcycle_label: "Honda CBR",
          status: "in_progress",
          status_label: "In Progress",
          docket_position: 3,
        },
        {
          job_id: "j-queued-second",
          work_order_id: "w3",
          work_order_number: "WO-3",
          service_name: "Brakes",
          motorcycle_label: "Yamaha R3",
          status: "approved",
          status_label: "Approved",
          docket_position: 4,
        },
      ],
      qcItems: [],
      safetyItems: [],
      flags: [],
      includeSafeties: false,
    });

    // NOW job leads regardless of position; queued jobs keep advisor order.
    expect(items.map((item) => item.job_id)).toEqual([
      "j-now",
      "j-queued-first",
      "j-queued-second",
    ]);
  });

  it("does not park an in-progress bike when a sibling job awaits approval", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j-original",
          work_order_id: "w1",
          work_order_number: "WO-1013",
          service_name: "Oil change",
          motorcycle_label: "Yamaha R3",
          status: "in_progress",
          status_label: "In Progress",
          docket_position: 1,
          floor_acknowledged_at: "2026-07-17T12:00:00Z",
          job_timer_running: true,
        },
        {
          job_id: "j-waiting",
          work_order_id: "w1",
          work_order_number: "WO-1013",
          service_name: "Chain kit",
          motorcycle_label: "Yamaha R3",
          status: "waiting_for_approval",
          status_label: "Waiting For Approval",
          docket_position: 2,
        },
      ],
      qcItems: [],
      safetyItems: [],
      flags: [],
      includeSafeties: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      job_id: "j-original",
      kind: "now",
      board_status: "bench",
      board_stamp: "NOW",
    });
  });

  it("shows approved recommendation jobs as NEW on the docket", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j-from-rec",
          work_order_id: "w1",
          work_order_number: "WO-1013",
          service_name: "Brake pads",
          motorcycle_label: "Yamaha R3",
          status: "approved",
          status_label: "Approved",
          docket_position: 1,
          floor_acknowledged_at: null,
        },
      ],
      qcItems: [],
      safetyItems: [],
      flags: [],
      includeSafeties: false,
    });

    expect(items[0]).toMatchObject({
      job_id: "j-from-rec",
      board_status: "offered",
      board_stamp: "NEW",
    });
  });

  it("lists every service on the bike card and keeps friendly stamps", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j-oil",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Oil change",
          motorcycle_label: "2024 Honda CB650R",
          status: "approved",
          status_label: "Approved",
          floor_acknowledged_at: "2026-07-17T12:00:00Z",
        },
        {
          job_id: "j-chain",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Chain kit",
          motorcycle_label: "2024 Honda CB650R",
          status: "approved",
          status_label: "Approved",
        },
      ],
      qcItems: [],
      safetyItems: [],
      flags: [],
      includeSafeties: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0].service_names).toEqual(["Oil change", "Chain kit"]);
    expect(stampDisplayLabel(items[0].board_stamp)).not.toMatch(/HOLD|PAUSED/);
  });

  it("shows WAIT instead of internal HOLD/PAUSED stamps", () => {
    expect(stampDisplayLabel("HOLD")).toBe("WAIT");
    expect(stampDisplayLabel("PAUSED")).toBe("WAIT");
    expect(stampDisplayLabel("NOW")).toBe("NOW");
    expect(stampDisplayLabel("CHECK")).toBe("CHECK");
  });

  it("marks bikes with a pending estimate but never freezes authorized work", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j1",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Brakes",
          motorcycle_label: "Yamaha R3",
          status: "in_progress",
          status_label: "In Progress",
          work_order_status: "waiting_for_customer_approval",
          floor_acknowledged_at: "2026-07-17T12:00:00Z",
          job_timer_running: true,
        },
      ],
      qcItems: [],
      safetyItems: [],
      flags: [],
      includeSafeties: false,
    });
    expect(items[0]).toMatchObject({
      awaiting_customer: true,
      board_status: "bench",
      board_stamp: "NOW",
    });
  });

  it("parks the whole bike with a front-desk wait when the WO is on hold", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j1",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Brakes",
          motorcycle_label: "Yamaha R3",
          status: "in_progress",
          status_label: "In Progress",
          work_order_status: "on_hold",
          floor_acknowledged_at: "2026-07-17T12:00:00Z",
          job_timer_running: true,
        },
      ],
      qcItems: [],
      safetyItems: [],
      flags: [],
      includeSafeties: false,
    });
    expect(items[0]).toMatchObject({
      board_status: "waiting",
      wait_owner_kind: "front_desk",
      wait_reason: "Bike is on hold — front desk owns it",
    });
    const { workNow, waiting } = splitDocketByWait(items);
    expect(workNow).toEqual([]);
    expect(waiting).toHaveLength(1);
  });

  it("puts each docket bike in exactly one of Work now / Waiting", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j-bench",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Oil",
          motorcycle_label: "Honda CBR",
          status: "in_progress",
          status_label: "In Progress",
          floor_acknowledged_at: "2026-07-17T12:00:00Z",
          job_timer_running: true,
        },
        {
          job_id: "j-parked",
          work_order_id: "w2",
          work_order_number: "WO-2",
          service_name: "Brakes",
          motorcycle_label: "Yamaha R3",
          status: "in_progress",
          status_label: "In Progress",
          floor_acknowledged_at: "2026-07-17T12:00:00Z",
          floor_parked_at: "2026-07-17T13:00:00Z",
          floor_park_reason: "parts",
        },
      ],
      qcItems: [
        { work_order_id: "w3", work_order_number: "WO-3", motorcycle_label: "Kawasaki" },
      ],
      safetyItems: [],
      flags: [],
      includeSafeties: false,
    });
    const { workNow, waiting } = splitDocketByWait(items);
    expect(workNow.length + waiting.length).toBe(items.length);
    expect(new Set([...workNow, ...waiting]).size).toBe(items.length);
    expect(waiting.map((item) => item.work_order_id)).toEqual(["w2"]);
    // The waiting card carries its own reason and owner — no separate panel.
    expect(waiting[0].wait_reason).toBe("Waiting for parts");
    expect(waiting[0].wait_owner_kind).toBe("parts");
  });

  it("never includes customer PII in docket display fields", () => {
    const items = buildTechnicianDocketItems({
      assignedJobs: [
        {
          job_id: "j1",
          work_order_id: "w1",
          work_order_number: "WO-1",
          service_name: "Oil",
          motorcycle_label: "Yamaha R3",
          status: "in_progress",
          status_label: "In Progress",
        },
      ],
      qcItems: [],
      safetyItems: [],
      flags: [
        {
          admin_flag_id: "f1",
          work_order_id: "w2",
          work_order_number: "WO-2",
          job_id: null,
          motorcycle_label: "Ducati Monster",
          reason: "parts",
          note: "Customer called about pickup",
        },
      ],
      includeSafeties: false,
    });

    for (const item of items) {
      expect(item.title.toLowerCase()).not.toContain("customer");
      expect(item.title.toLowerCase()).not.toContain("client");
      expect(docketCardJobLine(item).toLowerCase()).not.toContain("customer");
      expect(docketCardAccessibleName(item).toLowerCase()).not.toContain("customer");
    }

    const flag = items.find((item) => item.kind === "flag");
    expect(flag?.subtitle).toBe("WO-2");
    expect(flag?.subtitle).not.toContain("Customer");
  });
});
