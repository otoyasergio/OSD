import { describe, expect, it } from "vitest";
import {
  techJobPacketHref,
  floorTechWorkOrderRedirect,
} from "@/lib/technician/assignmentHref";

describe("techJobPacketHref", () => {
  it("builds packet URL with encoded wo", () => {
    expect(techJobPacketHref("wo/1")).toBe("/technician?wo=wo%2F1&panel=packet");
  });

  it("includes job and section when provided", () => {
    expect(techJobPacketHref("w1", { jobId: "j1", section: "notes" })).toBe(
      "/technician?wo=w1&panel=packet&job=j1&packetSection=notes"
    );
  });

  it("includes stage when provided", () => {
    expect(techJobPacketHref("w1", { stage: "done" })).toBe(
      "/technician?wo=w1&panel=packet&stage=done"
    );
  });
});

describe("floorTechWorkOrderRedirect", () => {
  it("sends inspection tab to inspection with returnTo floor", () => {
    expect(floorTechWorkOrderRedirect("w1", "inspection")).toBe(
      "/work_orders/w1/inspection?returnTo=%2Ftechnician%3Fwo%3Dw1"
    );
  });

  it("maps notes tab to packet notes section", () => {
    expect(floorTechWorkOrderRedirect("w1", "notes")).toBe(
      "/technician?wo=w1&panel=packet&packetSection=notes"
    );
  });

  it("maps photos tab to packet photos section", () => {
    expect(floorTechWorkOrderRedirect("w1", "photos")).toBe(
      "/technician?wo=w1&panel=packet&packetSection=photos"
    );
  });

  it("defaults other tabs to packet", () => {
    expect(floorTechWorkOrderRedirect("w1", "overview")).toBe(
      "/technician?wo=w1&panel=packet"
    );
    expect(floorTechWorkOrderRedirect("w1")).toBe("/technician?wo=w1&panel=packet");
  });
});
