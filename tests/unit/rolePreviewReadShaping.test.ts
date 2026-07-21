import { describe, expect, it } from "vitest";
import {
  buildKpis,
  subtitleForRole,
  type ControlCenterBike,
  type ControlCenterTech,
} from "@/lib/services/controlCenter";
import { mapJobPacketJobs } from "@/lib/services/jobPacket";
import type { JobStatus } from "@/lib/database/types";

function bike(partial: Partial<ControlCenterBike>): ControlCenterBike {
  return {
    work_order_id: "wo-1",
    work_order_number: "WO-1",
    status: "open",
    date_created: "2026-07-01",
    opened_at: null,
    technician_id: null,
    customer_name: "",
    bike_title: "",
    primary_photo_url: null,
    stage_label: "",
    stage_tone: "muted",
    flags: [],
    flag_badge: null,
    at_risk: false,
    status_dot: "green",
    last_job_activity_at: null,
    ...partial,
  };
}

function tech(partial: Partial<ControlCenterTech>): ControlCenterTech {
  return {
    user_id: "tech-1",
    first_name: "Tara",
    last_name: "TechA",
    role: "technician",
    availability: "available",
    assigned_bikes: [],
    ...partial,
  };
}

const BIKES = [
  bike({ work_order_id: "wo-1", technician_id: "tech-1", status: "in_progress" }),
  bike({ work_order_id: "wo-2", technician_id: null, at_risk: true }),
  bike({ work_order_id: "wo-3", technician_id: null, status: "ready_for_pickup" }),
];

const TECHS = [
  tech({ user_id: "tech-1", availability: "busy" }),
  tech({ user_id: "tech-2", availability: "available" }),
];

describe("control center role shaping", () => {
  it("labels the subtitle per presentation role", () => {
    expect(subtitleForRole("owner")).toContain("revenue");
    expect(subtitleForRole("manager")).toContain("Dispatch board");
    expect(subtitleForRole("service_advisor")).toBe(
      "Dispatch unassigned bikes and keep approvals moving."
    );
    expect(subtitleForRole("admin")).toBe(
      "Dispatch unassigned bikes and keep approvals moving."
    );
  });

  it("gives the owner preview financial KPIs when metrics load", () => {
    const kpis = buildKpis({
      role: "owner",
      bikes: BIKES,
      techs: TECHS,
      ownerMetrics: {
        revenueTodayCents: 123_400,
        completedToday: 2,
        avgDaysInShop: 3,
      },
    });
    expect(kpis.map((kpi) => kpi.label)).toEqual([
      "Revenue today",
      "Completed today",
      "Avg days in shop",
      "In shop now",
      "At risk",
    ]);
    expect(kpis[0]?.value).toContain("1,234");
  });

  it("gives the admin preview the operational strip without money", () => {
    const kpis = buildKpis({
      role: "admin",
      bikes: BIKES,
      techs: TECHS,
      ownerMetrics: null,
    });
    expect(kpis.map((kpi) => kpi.label)).toEqual([
      "In shop",
      "In bay",
      "Unassigned",
      "Techs available",
      "At risk",
    ]);
    expect(kpis.some((kpi) => kpi.label === "Revenue today")).toBe(false);
  });

  it("gives the service advisor preview approval and pickup KPIs", () => {
    const kpis = buildKpis({
      role: "service_advisor",
      bikes: BIKES,
      techs: TECHS,
      ownerMetrics: null,
    });
    expect(kpis.map((kpi) => kpi.label)).toEqual([
      "Unassigned",
      "Waiting approval",
      "Ready for pickup",
      "At risk",
      "In shop",
    ]);
  });
});

describe("job packet subject shaping", () => {
  const jobs = [
    {
      job_id: "job-1",
      service_name_snapshot: "Brakes",
      status: "in_progress" as JobStatus,
      assigned_technician_id: "tech-1",
      created_at: "2026-07-01T10:00:00Z",
    },
    {
      job_id: "job-2",
      service_name_snapshot: "Chain",
      status: "approved" as JobStatus,
      assigned_technician_id: "tech-2",
      created_at: "2026-07-01T11:00:00Z",
    },
    {
      job_id: "job-3",
      service_name_snapshot: "Cancelled",
      status: "cancelled" as JobStatus,
      assigned_technician_id: "tech-1",
      created_at: "2026-07-01T12:00:00Z",
    },
  ];

  it("marks assigned_to_me for the mirrored technician, not the caller", () => {
    const asTech1 = mapJobPacketJobs(jobs, "wo-1", "tech-1");
    expect(asTech1.map((job) => job.job_id)).toEqual(["job-1", "job-2"]);
    expect(asTech1.find((job) => job.job_id === "job-1")?.assigned_to_me).toBe(true);
    expect(asTech1.find((job) => job.job_id === "job-2")?.assigned_to_me).toBe(false);

    const asOwner = mapJobPacketJobs(jobs, "wo-1", "owner-1");
    expect(asOwner.every((job) => !job.assigned_to_me)).toBe(true);
  });
});
