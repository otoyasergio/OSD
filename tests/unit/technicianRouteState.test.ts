import { describe, expect, it } from "vitest";
import {
  isFloorStage,
  isJobPacketSection,
  parseTechnicianRouteState,
  technicianClosePacketHref,
  technicianFloorHref,
  technicianPacketHref,
} from "@/lib/technician/routeState";
import { techJobPacketHref } from "@/lib/technician/assignmentHref";

function paramsOf(href: string): URLSearchParams {
  return new URLSearchParams(href.split("?")[1] ?? "");
}

describe("parseTechnicianRouteState", () => {
  it("keeps valid params and nulls invalid ones", () => {
    expect(
      parseTechnicianRouteState({
        job: "j1",
        wo: "w1",
        stage: "proof",
        panel: "packet",
        packetSection: "photos",
      })
    ).toEqual({
      jobId: "j1",
      workOrderId: "w1",
      stage: "proof",
      panel: "packet",
      packetSection: "photos",
    });

    expect(
      parseTechnicianRouteState({
        stage: "warp-speed",
        panel: "sidebar",
        packetSection: "secrets",
      })
    ).toEqual({
      jobId: null,
      workOrderId: null,
      stage: null,
      panel: null,
      packetSection: null,
    });
  });

  it("accepts every documented stage and rejects the rest", () => {
    for (const stage of ["inspect", "work", "proof", "done", "qc", "safety"]) {
      expect(isFloorStage(stage)).toBe(true);
      expect(parseTechnicianRouteState({ stage }).stage).toBe(stage);
    }
    expect(isFloorStage("notes")).toBe(false);
    expect(isFloorStage("")).toBe(false);
    expect(isFloorStage(undefined)).toBe(false);
  });

  it("validates packet sections", () => {
    for (const section of ["notes", "photos", "jobs"]) {
      expect(isJobPacketSection(section)).toBe(true);
    }
    expect(isJobPacketSection("overview")).toBe(false);
    // Missing section means the packet opens on its top summary.
    expect(parseTechnicianRouteState({ panel: "packet" }).packetSection).toBeNull();
  });

  it("maps legacy mode deep links onto stages", () => {
    expect(parseTechnicianRouteState({ mode: "inspection" }).stage).toBe("inspect");
    expect(parseTechnicianRouteState({ mode: "parts" }).stage).toBe("work");
    expect(parseTechnicianRouteState({ mode: "job" }).stage).toBe("work");
    expect(parseTechnicianRouteState({ mode: "qc" }).stage).toBe("qc");
    expect(parseTechnicianRouteState({ mode: "safety" }).stage).toBe("safety");
    expect(parseTechnicianRouteState({ mode: "notes" }).stage).toBe("done");
    // Explicit stage wins over legacy mode.
    expect(parseTechnicianRouteState({ mode: "qc", stage: "work" }).stage).toBe("work");
  });

  it("treats blank ids as no selection", () => {
    const state = parseTechnicianRouteState({ job: " ", wo: "" });
    expect(state.jobId).toBeNull();
    expect(state.workOrderId).toBeNull();
  });
});

describe("stage-preserving href builders", () => {
  it("keeps the stage when opening the packet", () => {
    const href = technicianPacketHref({
      workOrderId: "w1",
      jobId: "j1",
      section: "photos",
      stage: "proof",
    });
    const params = paramsOf(href);
    expect(params.get("wo")).toBe("w1");
    expect(params.get("job")).toBe("j1");
    expect(params.get("panel")).toBe("packet");
    expect(params.get("packetSection")).toBe("photos");
    expect(params.get("stage")).toBe("proof");
  });

  it("keeps the stage and selection when closing the packet", () => {
    const href = technicianClosePacketHref({
      workOrderId: "w1",
      jobId: "j1",
      stage: "proof",
    });
    const params = paramsOf(href);
    expect(params.get("wo")).toBe("w1");
    expect(params.get("job")).toBe("j1");
    expect(params.get("stage")).toBe("proof");
    expect(params.get("panel")).toBeNull();
    expect(params.get("packetSection")).toBeNull();
  });

  it("round-trips open → close without losing the stage", () => {
    const open = technicianPacketHref({
      workOrderId: "w1",
      jobId: "j1",
      section: "notes",
      stage: "inspect",
    });
    const opened = parseTechnicianRouteState(
      Object.fromEntries(paramsOf(open).entries())
    );
    expect(opened.stage).toBe("inspect");
    expect(opened.panel).toBe("packet");

    const close = technicianClosePacketHref({
      workOrderId: opened.workOrderId!,
      jobId: opened.jobId,
      stage: opened.stage,
    });
    const closed = parseTechnicianRouteState(
      Object.fromEntries(paramsOf(close).entries())
    );
    expect(closed).toMatchObject({
      jobId: "j1",
      workOrderId: "w1",
      stage: "inspect",
      panel: null,
    });
  });

  it("omits stage when none was requested", () => {
    expect(paramsOf(technicianFloorHref({ workOrderId: "w1" })).has("stage")).toBe(false);
    expect(
      paramsOf(technicianPacketHref({ workOrderId: "w1", section: "notes" })).has("stage")
    ).toBe(false);
  });

  it("drops invalid stage strings in the legacy techJobPacketHref wrapper", () => {
    const href = techJobPacketHref("w1", { section: "notes", stage: "bogus" });
    expect(paramsOf(href).has("stage")).toBe(false);
    const valid = techJobPacketHref("w1", { section: "notes", stage: "done" });
    expect(paramsOf(valid).get("stage")).toBe("done");
  });

  it("encodes ids safely", () => {
    const href = technicianFloorHref({ workOrderId: "work order/1", jobId: "j 2" });
    const params = paramsOf(href);
    expect(params.get("wo")).toBe("work order/1");
    expect(params.get("job")).toBe("j 2");
  });
});
