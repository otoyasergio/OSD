import { describe, expect, it } from "vitest";
import { jobFloorHref, mapJobPacketJobs } from "@/lib/services/jobPacket";

describe("jobFloorHref", () => {
  it("builds floor URL with wo and job (no packet panel)", () => {
    expect(jobFloorHref("w1", "j1")).toBe("/technician?wo=w1&job=j1");
  });

  it("encodes special characters in ids", () => {
    expect(jobFloorHref("wo/1", "j/2")).toBe("/technician?wo=wo%2F1&job=j%2F2");
  });
});

describe("mapJobPacketJobs", () => {
  const rows = [
    {
      job_id: "j-cancelled",
      service_name_snapshot: "Cancelled service",
      status: "cancelled" as const,
      assigned_technician_id: "tech-1",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      job_id: "j-declined",
      service_name_snapshot: "Declined service",
      status: "declined" as const,
      assigned_technician_id: null,
      created_at: "2026-01-02T00:00:00Z",
    },
    {
      job_id: "j-b",
      service_name_snapshot: "Oil change",
      status: "in_progress" as const,
      assigned_technician_id: "tech-1",
      created_at: "2026-01-04T00:00:00Z",
    },
    {
      job_id: "j-a",
      service_name_snapshot: "Tire swap",
      status: "approved" as const,
      assigned_technician_id: "other",
      created_at: "2026-01-03T00:00:00Z",
    },
  ];

  it("drops cancelled/declined, sorts by created_at, maps floor shape", () => {
    const jobs = mapJobPacketJobs(rows, "w1", "tech-1");
    expect(jobs.map((j) => j.job_id)).toEqual(["j-a", "j-b"]);
    expect(jobs[0]).toMatchObject({
      service_name: "Tire swap",
      status: "approved",
      assigned_technician_id: "other",
      assigned_to_me: false,
      floor_href: "/technician?wo=w1&job=j-a",
    });
    expect(jobs[0]?.status_label).toBeTruthy();
    expect(jobs[1]).toMatchObject({
      assigned_to_me: true,
      floor_href: "/technician?wo=w1&job=j-b",
    });
  });
});
