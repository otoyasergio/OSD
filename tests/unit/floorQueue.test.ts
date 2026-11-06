import { describe, expect, it } from "vitest";
import {
  decideFloorQueue,
  formatWaitAge,
  isWorkableService,
  planFloorSync,
  planTechnicianClock,
  queueNoteLabel,
  startRefusal,
  type QueueBlocker,
  type QueueService,
} from "@/lib/technician/floorQueue";

const TECH = "tech-1";

function service(
  overrides: Partial<QueueService> &
    Pick<QueueService, "job_id" | "work_order_id" | "status">
): QueueService {
  return {
    assigned_technician_id: TECH,
    docket_position: 1,
    parts: [],
    ...overrides,
  };
}

describe("isWorkableService", () => {
  it("accepts approved work with no blocking part", () => {
    expect(
      isWorkableService({ status: "approved", parts: [{ status: "in_stock" }] })
    ).toBe(true);
    expect(isWorkableService({ status: "ready_to_start" })).toBe(true);
    expect(isWorkableService({ status: "in_progress" })).toBe(true);
  });

  it("rejects approval waits, finished work, and needed or ordered parts", () => {
    expect(isWorkableService({ status: "waiting_for_approval" })).toBe(false);
    expect(isWorkableService({ status: "completed" })).toBe(false);
    expect(isWorkableService({ status: "declined" })).toBe(false);
    expect(
      isWorkableService({ status: "in_progress", parts: [{ status: "ordered" }] })
    ).toBe(false);
    expect(isWorkableService({ status: "approved", parts: [{ status: "needed" }] })).toBe(
      false
    );
  });
});

describe("decideFloorQueue", () => {
  it("keeps a bike on the bench when another service can still be worked", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "pads",
          work_order_id: "bike",
          status: "waiting_for_approval",
          service_name: "Brake pads",
          docket_position: 1,
          timer_running: false,
        }),
        service({
          job_id: "oil",
          work_order_id: "bike",
          status: "in_progress",
          service_name: "Oil change",
          docket_position: 2,
          timer_running: true,
        }),
      ],
      blockers: [{ job_id: "pads", kind: "approval", opened_at: "2026-11-04T12:00:00Z" }],
    });
    const bike = decision.bikes[0];
    expect(bike?.lane).toBe("bench");
    expect(bike?.notes.map(queueNoteLabel)).toEqual([
      "Brake pads — waiting on the customer",
    ]);
    expect(decision.bench_work_order_id).toBe("bike");
  });

  it("keeps the bike in line when one service waits on parts and another on the customer", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "pads",
          work_order_id: "bike",
          status: "waiting_for_approval",
          service_name: "Brake pads",
          docket_position: 2,
        }),
        service({
          job_id: "tire",
          work_order_id: "bike",
          status: "approved",
          service_name: "Tire",
          docket_position: 3,
          parts: [{ status: "ordered" }],
        }),
      ],
      blockers: [
        { job_id: "pads", kind: "approval", opened_at: "2026-11-04T10:00:00Z" },
        { job_id: "tire", kind: "parts", opened_at: "2026-11-04T11:00:00Z" },
      ],
    });
    expect(decision.bikes[0]).toMatchObject({
      lane: "line",
      reason: null,
      can_start: true,
    });
    expect(decision.bikes[0]?.notes.map(queueNoteLabel)).toEqual([
      "Brake pads — waiting on the customer",
      "Tire — waiting on parts",
    ]);
    expect(startRefusal(decision, "bike")).toBeNull();
  });

  it("keeps a parts-waiting bike in line so the tech can start it", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "tire",
          work_order_id: "bike",
          status: "waiting_for_parts",
          parts: [{ status: "needed" }],
        }),
      ],
      blockers: [{ job_id: "tire", kind: "parts", opened_at: "2026-11-04T09:00:00Z" }],
    });
    expect(decision.bikes[0]).toMatchObject({
      lane: "line",
      reason: null,
      can_start: true,
    });
    expect(decision.bikes[0]?.notes.map(queueNoteLabel)).toEqual([
      "Service — waiting on parts",
    ]);
    expect(startRefusal(decision, "bike")).toBeNull();
  });

  it("lets a parts-waiting bike start even when another bike is earlier in line", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "first",
          work_order_id: "ahead",
          status: "approved",
          docket_position: 1,
        }),
        service({
          job_id: "tire",
          work_order_id: "parts",
          status: "waiting_for_parts",
          docket_position: 2,
          parts: [{ status: "ordered" }],
        }),
      ],
    });
    expect(startRefusal(decision, "parts")).toBeNull();
    expect(startRefusal(decision, "ahead")).toBeNull();
  });

  it("takes the whole bike for a tool wait even when work remains", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "oil",
          work_order_id: "bike",
          status: "in_progress",
          timer_running: false,
        }),
      ],
      blockers: [{ job_id: "oil", kind: "tool", opened_at: "2026-11-04T08:00:00Z" }],
    });
    expect(decision.bikes[0]).toMatchObject({
      lane: "waiting",
      reason: "tool",
      owner: "technician",
      can_start: false,
    });
  });

  it("ignores a closed work order that shares the first docket position", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "ghost",
          work_order_id: "closed",
          status: "in_progress",
          docket_position: 1,
          work_order_status: "completed",
        }),
        service({
          job_id: "live",
          work_order_id: "open",
          status: "approved",
          docket_position: 1,
          work_order_status: "waiting_for_parts",
        }),
        service({
          job_id: "stored",
          work_order_id: "storage",
          status: "in_progress",
          docket_position: 2,
          work_order_status: "in_storage",
        }),
      ],
    });
    expect(decision.bikes.map((bike) => bike.work_order_id)).toEqual(["open"]);
    expect(startRefusal(decision, "open")).toBeNull();
    expect(startRefusal(decision, "closed")).toBe("START_NOT_NEXT");
  });

  it("starts any assigned bike when the bench is empty", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "a",
          work_order_id: "first",
          status: "approved",
          docket_position: 1,
        }),
        service({
          job_id: "b",
          work_order_id: "second",
          status: "ready_to_start",
          docket_position: 2,
        }),
      ],
    });
    expect(startRefusal(decision, "first")).toBeNull();
    expect(startRefusal(decision, "second")).toBeNull();
    expect(decision.bikes.find((bike) => bike.work_order_id === "first")?.can_start).toBe(
      true
    );
    expect(
      decision.bikes.find((bike) => bike.work_order_id === "second")?.can_start
    ).toBe(true);
  });

  it("refuses a different bike while one clock is running", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "a",
          work_order_id: "bench",
          status: "in_progress",
          docket_position: 1,
          timer_running: true,
        }),
        service({
          job_id: "b",
          work_order_id: "next",
          status: "approved",
          docket_position: 2,
        }),
      ],
    });
    expect(startRefusal(decision, "next")).toBe("START_BENCH_OCCUPIED");
  });

  it("keeps the running service when its parts are still on order", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "oil",
          work_order_id: "bike",
          status: "in_progress",
          docket_position: 1,
          timer_running: true,
        }),
        service({
          job_id: "chain",
          work_order_id: "bike",
          status: "approved",
          docket_position: 2,
        }),
      ],
    });
    expect(startRefusal(decision, "bike")).toBeNull();
    expect(
      planTechnicianClock({
        technician_id: TECH,
        services: decision.bikes.length
          ? [
              service({
                job_id: "oil",
                work_order_id: "bike",
                status: "in_progress",
                parts: [{ status: "ordered" }],
                timer_running: true,
                docket_position: 1,
              }),
              service({
                job_id: "chain",
                work_order_id: "bike",
                status: "approved",
                docket_position: 2,
              }),
            ]
          : [],
      })
    ).toMatchObject({ action: "keep", job_id: "oil" });
  });

  it("refuses a waiting bike", () => {
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "a",
          work_order_id: "held",
          status: "waiting_for_approval",
          docket_position: 1,
        }),
        service({
          job_id: "b",
          work_order_id: "free",
          status: "approved",
          docket_position: 2,
        }),
      ],
    });
    expect(startRefusal(decision, "held")).toBe("START_WAITING");
    expect(startRefusal(decision, "free")).toBeNull();
  });

  it("returns a cleared bike to its current place without putting it on the bench", () => {
    const blockers: QueueBlocker[] = [];
    const decision = decideFloorQueue({
      technician_id: TECH,
      services: [
        service({
          job_id: "late",
          work_order_id: "returned",
          status: "approved",
          docket_position: 4,
          timer_running: false,
        }),
        service({
          job_id: "ahead",
          work_order_id: "ahead",
          status: "approved",
          docket_position: 1,
        }),
      ],
      blockers,
    });
    const returned = decision.bikes.find((bike) => bike.work_order_id === "returned");
    expect(returned).toMatchObject({ lane: "line", position: 4, can_start: true });
    expect(decision.bench_work_order_id).toBeNull();
    expect(startRefusal(decision, "returned")).toBeNull();
    expect(startRefusal(decision, "ahead")).toBeNull();
  });
});

describe("planFloorSync", () => {
  it("opens one blocker and does not open it again", () => {
    const services = [
      service({
        job_id: "pads",
        work_order_id: "bike",
        status: "waiting_for_approval",
      }),
    ];
    const first = planFloorSync({ services });
    expect(first.open).toEqual([
      { job_id: "pads", kind: "approval", owner: "front_desk" },
    ]);
    const second = planFloorSync({
      services,
      blockers: [{ job_id: "pads", kind: "approval", opened_at: "2026-11-04T12:00:00Z" }],
    });
    expect(second.open).toEqual([]);
    expect(second.close).toEqual([]);
  });

  it("closes the blocker when the service can be worked again and does not start a clock", () => {
    const plan = planFloorSync({
      services: [
        service({
          job_id: "pads",
          work_order_id: "bike",
          status: "approved",
          timer_running: false,
        }),
      ],
      blockers: [{ job_id: "pads", kind: "approval", opened_at: "2026-11-04T12:00:00Z" }],
    });
    expect(plan.close).toEqual([{ job_id: "pads", kind: "approval" }]);
    expect(plan.clocks).toEqual([{ technician_id: TECH, action: "keep", job_id: null }]);
  });

  it("keeps the clock running when the bench service is waiting on parts", () => {
    const plan = planFloorSync({
      services: [
        service({
          job_id: "oil",
          work_order_id: "bike",
          status: "in_progress",
          parts: [{ status: "needed" }],
          timer_running: true,
        }),
      ],
    });
    expect(plan.open).toEqual([{ job_id: "oil", kind: "parts", owner: "parts" }]);
    expect(plan.clocks[0]).toMatchObject({ action: "keep", job_id: "oil" });
  });

  it("leaves a tool blocker alone", () => {
    const plan = planFloorSync({
      services: [
        service({
          job_id: "oil",
          work_order_id: "bike",
          status: "in_progress",
          timer_running: true,
        }),
      ],
      blockers: [{ job_id: "oil", kind: "tool", opened_at: "2026-11-04T08:00:00Z" }],
    });
    expect(plan.open).toEqual([]);
    expect(plan.close).toEqual([]);
    expect(plan.clocks[0]).toMatchObject({ action: "stop" });
  });
});

describe("formatWaitAge", () => {
  it("formats minutes and hours from the open time", () => {
    const opened = "2026-11-04T12:00:00Z";
    const now = Date.parse("2026-11-04T13:05:00Z");
    expect(formatWaitAge(opened, now)).toBe("1h 5m");
    expect(formatWaitAge(null)).toBe("");
  });
});
