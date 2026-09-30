import { describe, expect, it } from "vitest";
import {
  controlCenterCohortHref,
  filterControlCenterCohort,
  flattenControlCenterBikes,
  parseControlCenterCohort,
} from "@/lib/control-center/cohorts";
import type { ControlCenterBike } from "@/lib/services/controlCenter";

function bike(
  overrides: Partial<ControlCenterBike> & Pick<ControlCenterBike, "work_order_id">
): ControlCenterBike {
  return {
    work_order_number: "WO-1",
    status: "in_progress",
    date_created: "2026-07-14T12:00:00.000Z",
    opened_at: null,
    technician_id: "tech-1",
    customer_name: "Ada Lovelace",
    bike_title: "2020 Honda CB500",
    primary_photo_url: null,
    stage_label: "In bay",
    stage_tone: "orange",
    flags: [],
    flag_badge: null,
    at_risk: false,
    status_dot: "green",
    last_job_activity_at: null,
    ...overrides,
  };
}

describe("parseControlCenterCohort", () => {
  it("accepts known cohort keys", () => {
    expect(parseControlCenterCohort("at_risk")).toBe("at_risk");
    expect(parseControlCenterCohort("completed_today")).toBe("completed_today");
    expect(parseControlCenterCohort("in_shop")).toBe("in_shop");
  });

  it("rejects unknown values", () => {
    expect(parseControlCenterCohort("")).toBe(null);
    expect(parseControlCenterCohort("revenue")).toBe(null);
    expect(parseControlCenterCohort(undefined)).toBe(null);
  });
});

describe("controlCenterCohortHref", () => {
  it("builds the control-center cohort query", () => {
    expect(controlCenterCohortHref("at_risk")).toBe("/control-center?cohort=at_risk");
  });
});

describe("flattenControlCenterBikes", () => {
  it("dedupes pool and tech assignments", () => {
    const shared = bike({ work_order_id: "wo-1" });
    const onlyPool = bike({ work_order_id: "wo-2", technician_id: null });
    const onlyTech = bike({ work_order_id: "wo-3" });
    const result = flattenControlCenterBikes({
      pool: [shared, onlyPool],
      techs: [{ assigned_bikes: [shared, onlyTech] }],
    });
    expect(result.map((row) => row.work_order_id).sort()).toEqual([
      "wo-1",
      "wo-2",
      "wo-3",
    ]);
  });
});

describe("filterControlCenterCohort", () => {
  const bikes = [
    bike({
      work_order_id: "wo-risk",
      at_risk: true,
      technician_id: null,
      status: "ready_for_technician",
    }),
    bike({
      work_order_id: "wo-bay",
      status: "in_progress",
      technician_id: "tech-1",
    }),
    bike({
      work_order_id: "wo-approve",
      status: "waiting_for_customer_approval",
      technician_id: "tech-1",
    }),
    bike({
      work_order_id: "wo-pickup",
      status: "ready_for_pickup",
      technician_id: "tech-2",
    }),
  ];

  it("returns all bikes for in_shop", () => {
    expect(filterControlCenterCohort(bikes, "in_shop")).toHaveLength(4);
  });

  it("filters at_risk / in_bay / unassigned / waiting / pickup", () => {
    expect(
      filterControlCenterCohort(bikes, "at_risk").map((b) => b.work_order_id)
    ).toEqual(["wo-risk"]);
    expect(
      filterControlCenterCohort(bikes, "in_bay").map((b) => b.work_order_id)
    ).toEqual(["wo-bay"]);
    expect(
      filterControlCenterCohort(bikes, "unassigned").map((b) => b.work_order_id)
    ).toEqual(["wo-risk"]);
    expect(
      filterControlCenterCohort(bikes, "waiting_approval").map((b) => b.work_order_id)
    ).toEqual(["wo-approve"]);
    expect(
      filterControlCenterCohort(bikes, "ready_for_pickup").map((b) => b.work_order_id)
    ).toEqual(["wo-pickup"]);
  });

  it("returns empty for completed_today (loaded separately)", () => {
    expect(filterControlCenterCohort(bikes, "completed_today")).toEqual([]);
  });
});
