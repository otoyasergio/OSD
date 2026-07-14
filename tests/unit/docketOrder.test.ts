import { describe, expect, it } from "vitest";
import {
  moveDocketJob,
  nextDocketPosition,
  sortByDocketPosition,
} from "@/lib/technician/docketOrder";

describe("sortByDocketPosition", () => {
  it("orders by position ascending with unpositioned jobs last in input order", () => {
    const sorted = sortByDocketPosition([
      { job_id: "c", docket_position: null },
      { job_id: "b", docket_position: 2 },
      { job_id: "d", docket_position: null },
      { job_id: "a", docket_position: 1 },
    ]);
    expect(sorted.map((job) => job.job_id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("nextDocketPosition", () => {
  it("returns 1 for an empty docket", () => {
    expect(nextDocketPosition([])).toBe(1);
  });

  it("appends after the highest position, ignoring nulls and gaps", () => {
    expect(nextDocketPosition([2, null, 5])).toBe(6);
  });
});

describe("moveDocketJob", () => {
  const docket = [
    { job_id: "a", docket_position: 1 },
    { job_id: "b", docket_position: 2 },
    { job_id: "c", docket_position: 3 },
  ];

  it("moves a job up one slot and reports both changed rows", () => {
    expect(moveDocketJob(docket, "b", "up")).toEqual([
      { job_id: "b", docket_position: 1 },
      { job_id: "a", docket_position: 2 },
    ]);
  });

  it("moves a job down one slot", () => {
    expect(moveDocketJob(docket, "b", "down")).toEqual([
      { job_id: "c", docket_position: 2 },
      { job_id: "b", docket_position: 3 },
    ]);
  });

  it("moves a job to the top and renumbers everything between", () => {
    expect(moveDocketJob(docket, "c", "top")).toEqual([
      { job_id: "c", docket_position: 1 },
      { job_id: "a", docket_position: 2 },
      { job_id: "b", docket_position: 3 },
    ]);
  });

  it("returns no changes when the job is already at the edge", () => {
    expect(moveDocketJob(docket, "a", "up")).toEqual([]);
    expect(moveDocketJob(docket, "c", "down")).toEqual([]);
  });

  it("normalizes gaps and unpositioned jobs even on an edge move", () => {
    const messy = [
      { job_id: "a", docket_position: 4 },
      { job_id: "b", docket_position: null },
      { job_id: "c", docket_position: 9 },
    ];
    expect(moveDocketJob(messy, "a", "up")).toEqual([
      { job_id: "a", docket_position: 1 },
      { job_id: "c", docket_position: 2 },
      { job_id: "b", docket_position: 3 },
    ]);
  });

  it("returns nothing for an unknown job id", () => {
    expect(moveDocketJob(docket, "zzz", "up")).toEqual([]);
  });
});
