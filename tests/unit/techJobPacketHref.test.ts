import { describe, expect, it } from "vitest";
import {
  techJobPacketHref,
  floorTechWorkOrderRedirect,
  floorInspectionHrefs,
  safeFloorReturnTo,
  floorWorkReturnFromInspectBack,
  floorAssistantReturnHref,
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

describe("floorInspectionHrefs", () => {
  it("sends Back to inspect and Complete to work, with job when present", () => {
    const hrefs = floorInspectionHrefs({ workOrderId: "w1", jobId: "j1" });
    expect(hrefs.back).toBe("/technician?job=j1&wo=w1&stage=inspect");
    expect(hrefs.complete).toBe("/technician?job=j1&wo=w1&stage=work");
    expect(hrefs.inspectPage).toBe(
      `/work_orders/w1/inspection?returnTo=${encodeURIComponent(hrefs.back)}`
    );
  });

  it("omits job from the floor return when it is missing", () => {
    const hrefs = floorInspectionHrefs({ workOrderId: "w1" });
    expect(hrefs.back).toBe("/technician?wo=w1&stage=inspect");
    expect(hrefs.complete).toBe("/technician?wo=w1&stage=work");
  });
});

describe("safeFloorReturnTo", () => {
  it("allows only /technician paths", () => {
    expect(safeFloorReturnTo("/technician?wo=w1&stage=work")).toBe(
      "/technician?wo=w1&stage=work"
    );
    expect(safeFloorReturnTo("//evil.example/technician")).toBeNull();
    expect(safeFloorReturnTo("/work_orders/w1")).toBeNull();
    expect(safeFloorReturnTo("https://example.com/technician")).toBeNull();
  });

  it("rejects cross-origin and protocol-relative assistant returns", () => {
    expect(
      floorAssistantReturnHref(
        "41111111-1111-4111-8111-111111111111",
        "71111111-1111-4111-8111-111111111111",
        "https://evil.example/technician?wo=41111111-1111-4111-8111-111111111111"
      )
    ).toBeNull();
    expect(
      floorAssistantReturnHref(
        "41111111-1111-4111-8111-111111111111",
        "71111111-1111-4111-8111-111111111111",
        "//evil.example/technician?wo=41111111-1111-4111-8111-111111111111"
      )
    ).toBeNull();
  });

  it("maps an inspect-stage back URL to Work", () => {
    expect(floorWorkReturnFromInspectBack("/technician?job=j1&wo=w1&stage=inspect")).toBe(
      "/technician?job=j1&wo=w1&stage=work"
    );
  });
});

describe("floorAssistantReturnHref", () => {
  it("preserves the validated work order and job on the assistant packet", () => {
    expect(
      floorAssistantReturnHref(
        "41111111-1111-4111-8111-111111111111",
        "71111111-1111-4111-8111-111111111111",
        "/technician?job=51111111-1111-4111-8111-111111111111&wo=41111111-1111-4111-8111-111111111111&stage=work"
      )
    ).toBe(
      "/technician?wo=41111111-1111-4111-8111-111111111111&panel=packet&job=51111111-1111-4111-8111-111111111111&packetSection=assistant&stage=work&assistantThread=71111111-1111-4111-8111-111111111111"
    );
  });

  it("rejects a return for another work order and drops an invalid job", () => {
    expect(
      floorAssistantReturnHref(
        "41111111-1111-4111-8111-111111111111",
        "71111111-1111-4111-8111-111111111111",
        "/technician?wo=81111111-1111-4111-8111-111111111111&stage=work"
      )
    ).toBeNull();
    expect(
      floorAssistantReturnHref(
        "41111111-1111-4111-8111-111111111111",
        "71111111-1111-4111-8111-111111111111",
        "/technician?job=not-a-uuid&wo=41111111-1111-4111-8111-111111111111&stage=work"
      )
    ).toBe(
      "/technician?wo=41111111-1111-4111-8111-111111111111&panel=packet&packetSection=assistant&stage=work&assistantThread=71111111-1111-4111-8111-111111111111"
    );
  });
});

describe("floorTechWorkOrderRedirect", () => {
  it("sends inspection tab to inspection with returnTo floor", () => {
    expect(floorTechWorkOrderRedirect("w1", "inspection")).toBe(
      `/work_orders/w1/inspection?returnTo=${encodeURIComponent("/technician?wo=w1&stage=inspect")}`
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
