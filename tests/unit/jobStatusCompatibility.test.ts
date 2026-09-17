import { describe, expect, it } from "vitest";
import type { JobStatus } from "@/lib/database/types";
import {
  mapLegacyJobStatus,
  mapLegacyWorkOrderStatus,
  projectLegacyJobStatus,
  projectLegacyWorkOrderStatus,
} from "@/lib/jobs-v2/statusMapping";

const ALL_LEGACY_JOB_STATUSES: JobStatus[] = [
  "draft",
  "waiting_for_approval",
  "approved",
  "declined",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
  "completed",
  "cancelled",
];

describe("legacy job status ↔ V2 facets", () => {
  it("round-trips every legacy status without loss", () => {
    for (const status of ALL_LEGACY_JOB_STATUSES) {
      const facets = mapLegacyJobStatus(status);
      expect(projectLegacyJobStatus(facets)).toBe(status);
    }
  });

  it("separates approval from readiness", () => {
    expect(mapLegacyJobStatus("approved")).toMatchObject({
      workState: "planned",
      authorization: "approved",
    });
    expect(mapLegacyJobStatus("ready_to_start")).toMatchObject({
      workState: "ready",
      authorization: "approved",
    });
  });

  it("maps waiting_for_parts to an approved job with a parts blocker", () => {
    expect(mapLegacyJobStatus("waiting_for_parts")).toEqual({
      workState: "planned",
      authorization: "approved",
      presented: true,
      partsBlocked: true,
    });
  });

  it("distinguishes draft from presented pending decisions", () => {
    expect(mapLegacyJobStatus("draft").presented).toBe(false);
    expect(mapLegacyJobStatus("waiting_for_approval").presented).toBe(true);
  });

  it("projects deferred as declined for legacy consumers", () => {
    expect(
      projectLegacyJobStatus({
        workState: "planned",
        authorization: "deferred",
        presented: true,
        partsBlocked: false,
      })
    ).toBe("declined");
  });

  it("terminal work states dominate authorization in projection", () => {
    expect(
      projectLegacyJobStatus({
        workState: "cancelled",
        authorization: "approved",
        presented: true,
        partsBlocked: true,
      })
    ).toBe("cancelled");
    expect(
      projectLegacyJobStatus({
        workState: "completed",
        authorization: "approved",
        presented: true,
        partsBlocked: false,
      })
    ).toBe("completed");
  });
});

describe("legacy work order status ↔ lifecycle", () => {
  it("maps terminal and hold statuses to lifecycle states", () => {
    expect(mapLegacyWorkOrderStatus("draft")).toBe("draft");
    expect(mapLegacyWorkOrderStatus("completed")).toBe("closed");
    expect(mapLegacyWorkOrderStatus("cancelled")).toBe("cancelled");
    expect(mapLegacyWorkOrderStatus("on_hold")).toBe("on_hold");
  });

  it("maps every operational status to active", () => {
    for (const status of [
      "open",
      "inspection_in_progress",
      "waiting_for_customer_approval",
      "waiting_for_parts",
      "ready_for_technician",
      "in_progress",
      "quality_check",
      "safety_check",
      "ready_for_pickup",
    ] as const) {
      expect(mapLegacyWorkOrderStatus(status)).toBe("active");
    }
  });
});

describe("legacy work order projection (dual-write fidelity)", () => {
  const base = {
    lifecycleState: "active" as const,
    anyPendingDecision: false,
    anyPartsBlocked: false,
    anyInProgress: false,
    anyReady: false,
    allAuthorizedWorkComplete: false,
    hasCompletedWork: false,
    qcPassed: false,
    safetyRequired: false,
    safetyPassed: false,
    agreementSigned: true,
    inspectionInProgress: false,
  };

  it("preserves the legacy pending-decision freeze for old consumers", () => {
    expect(
      projectLegacyWorkOrderStatus({
        ...base,
        anyPendingDecision: true,
        anyInProgress: true,
      })
    ).toBe("waiting_for_customer_approval");
  });

  it("walks the finish path: qc, then safety, then pickup", () => {
    const finished = {
      ...base,
      allAuthorizedWorkComplete: true,
      hasCompletedWork: true,
    };
    expect(projectLegacyWorkOrderStatus(finished)).toBe("quality_check");
    expect(projectLegacyWorkOrderStatus({ ...finished, qcPassed: true })).toBe(
      "ready_for_pickup"
    );
    expect(
      projectLegacyWorkOrderStatus({
        ...finished,
        qcPassed: true,
        safetyRequired: true,
      })
    ).toBe("safety_check");
    expect(
      projectLegacyWorkOrderStatus({
        ...finished,
        qcPassed: true,
        safetyRequired: true,
        safetyPassed: true,
      })
    ).toBe("ready_for_pickup");
  });

  it("maps ready work, holds, and terminal lifecycles", () => {
    expect(projectLegacyWorkOrderStatus({ ...base, anyReady: true })).toBe(
      "ready_for_technician"
    );
    expect(
      projectLegacyWorkOrderStatus({
        ...base,
        anyReady: true,
        agreementSigned: false,
      })
    ).toBe("open");
    expect(projectLegacyWorkOrderStatus({ ...base, lifecycleState: "on_hold" })).toBe(
      "on_hold"
    );
    expect(projectLegacyWorkOrderStatus({ ...base, lifecycleState: "closed" })).toBe(
      "completed"
    );
    expect(projectLegacyWorkOrderStatus({ ...base, lifecycleState: "cancelled" })).toBe(
      "cancelled"
    );
    expect(projectLegacyWorkOrderStatus({ ...base, lifecycleState: "draft" })).toBe(
      "draft"
    );
  });

  it("prefers parts wait over idle and in-progress over parts wait", () => {
    expect(projectLegacyWorkOrderStatus({ ...base, anyPartsBlocked: true })).toBe(
      "waiting_for_parts"
    );
    expect(
      projectLegacyWorkOrderStatus({
        ...base,
        anyPartsBlocked: true,
        anyInProgress: true,
      })
    ).toBe("in_progress");
  });
});
