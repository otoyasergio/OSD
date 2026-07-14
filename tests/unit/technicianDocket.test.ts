import { describe, expect, it } from "vitest";
import { buildTechnicianDocketItems } from "@/lib/services/technicianDocket";

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

  it("never includes customer PII in titles", () => {
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
      flags: [],
      includeSafeties: false,
    });
    expect(items[0].title).toBe("Yamaha R3 · Oil");
    expect(items[0].title.toLowerCase()).not.toContain("customer");
  });
});
