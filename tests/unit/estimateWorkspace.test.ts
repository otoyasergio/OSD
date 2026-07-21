import { describe, expect, it } from "vitest";
import {
  amendmentNotice,
  authorizationChip,
  buildJobDraft,
  buildWorkspaceDrafts,
  computeWorkspaceTotals,
  decisionsComplete,
  estimableJobs,
  parseMoneyInputToCents,
  rollupPartsForJob,
  seedPricingState,
  toDecisionList,
  workProgressChip,
  workspacePresentationBlockers,
  type WorkspaceJob,
  type WorkspacePart,
} from "@/components/estimates/workspaceModel";
import {
  buildEstimateVersionSnapshot,
  presentationBlockers,
} from "@/lib/services/estimatePricing";
import { resolveWorkOrderTabId } from "@/lib/workOrders/tabs";

function job(overrides: Partial<WorkspaceJob> = {}): WorkspaceJob {
  return {
    job_id: "job-1",
    title: "Brake service",
    status: "draft",
    standard_price_snapshot: 120.5,
    assigned_technician_name: null,
    ...overrides,
  };
}

function part(overrides: Partial<WorkspacePart> = {}): WorkspacePart {
  return {
    part_id: "part-1",
    job_id: "job-1",
    part_name: "Brake pads",
    quantity: 2,
    unit_price: 45,
    status: "needed",
    ...overrides,
  };
}

describe("resolveWorkOrderTabId", () => {
  it("keeps valid tab ids", () => {
    expect(resolveWorkOrderTabId("estimate")).toBe("estimate");
    expect(resolveWorkOrderTabId("parts")).toBe("parts");
  });

  it("routes retired jobs/recommendations bookmarks to the merged tab", () => {
    expect(resolveWorkOrderTabId("jobs")).toBe("estimate");
    expect(resolveWorkOrderTabId("recommendations")).toBe("estimate");
  });

  it("falls back to overview for unknown or missing values", () => {
    expect(resolveWorkOrderTabId("nope")).toBe("overview");
    expect(resolveWorkOrderTabId(undefined)).toBe("overview");
    expect(resolveWorkOrderTabId(null)).toBe("overview");
  });
});

describe("parseMoneyInputToCents", () => {
  it("converts dollars text to integer cents", () => {
    expect(parseMoneyInputToCents("120.50")).toBe(12050);
    expect(parseMoneyInputToCents("0")).toBe(0);
    expect(parseMoneyInputToCents(" 45 ")).toBe(4500);
  });

  it("rejects empty, invalid, and negative input", () => {
    expect(parseMoneyInputToCents("")).toBeNull();
    expect(parseMoneyInputToCents("abc")).toBeNull();
    expect(parseMoneyInputToCents("-5")).toBeNull();
  });
});

describe("parts rollup", () => {
  it("rolls up priced parts and counts missing prices", () => {
    const rollup = rollupPartsForJob(
      [
        part(),
        part({ part_id: "part-2", unit_price: null }),
        part({ part_id: "part-3", status: "cancelled", unit_price: 99 }),
        part({ part_id: "part-4", status: "not_required", unit_price: 99 }),
        part({ part_id: "part-5", job_id: "job-other" }),
      ],
      "job-1"
    );
    expect(rollup.count).toBe(2);
    expect(rollup.knownTotalCents).toBe(9000);
    expect(rollup.missingPriceCount).toBe(1);
  });
});

describe("draft assembly", () => {
  it("seeds labour from the legacy price and defaults to itemized", () => {
    const state = seedPricingState(job());
    expect(state.mode).toBe("itemized");
    expect(state.labourText).toBe("120.5");

    const draft = buildJobDraft(job(), rollupPartsForJob([part()], "job-1"), state);
    expect(draft.pricing.pricingMode).toBe("itemized");
    expect(draft.pricing.laborLines).toEqual([
      { amountCents: 12050, billable: true, includedInPackage: false },
    ]);
    expect(draft.pricing.partLines).toEqual([
      { quantity: 2, sellPriceCents: 4500, includedInPackage: false },
    ]);
  });

  it("marks labour and parts as included when priced as a package", () => {
    const state = {
      ...seedPricingState(job()),
      mode: "fixed_package" as const,
      packageText: "300",
    };
    const draft = buildJobDraft(job(), rollupPartsForJob([part()], "job-1"), state);
    expect(draft.pricing.fixedPackagePriceCents).toBe(30000);
    expect(draft.pricing.laborLines[0].includedInPackage).toBe(true);
    expect(draft.pricing.partLines[0].includedInPackage).toBe(true);
  });

  it("excludes cancelled jobs from the estimate document", () => {
    const jobs = [job(), job({ job_id: "job-2", status: "cancelled" })];
    expect(estimableJobs(jobs).map((j) => j.job_id)).toEqual(["job-1"]);
    expect(buildWorkspaceDrafts(jobs, [], {})).toHaveLength(1);
  });
});

describe("workspace totals and blockers mirror the server snapshot", () => {
  it("matches buildEstimateVersionSnapshot totals for the same drafts", () => {
    const drafts = buildWorkspaceDrafts(
      [job(), job({ job_id: "job-2", title: "Chain", standard_price_snapshot: 50 })],
      [part(), part({ part_id: "p2", job_id: "job-2", quantity: 1, unit_price: 12.34 })],
      {}
    );
    const totals = computeWorkspaceTotals(drafts);
    const snapshot = buildEstimateVersionSnapshot(drafts);
    expect(totals).toEqual(snapshot.totals);
  });

  it("produces the same blocker codes as presentationBlockers", () => {
    const missing = buildWorkspaceDrafts([job()], [part({ unit_price: null })], {});
    const totals = computeWorkspaceTotals(missing);
    const clientBlockers = workspacePresentationBlockers(missing, totals);
    const serverBlockers = presentationBlockers(buildEstimateVersionSnapshot(missing));
    expect(clientBlockers).toEqual(serverBlockers);
    expect(clientBlockers).toContain("ESTIMATE_MISSING_PRICES");

    expect(workspacePresentationBlockers([], computeWorkspaceTotals([]))).toEqual(
      presentationBlockers(buildEstimateVersionSnapshot([]))
    );
  });

  it("blocks a package job with no package price", () => {
    const drafts = buildWorkspaceDrafts([job()], [], {
      "job-1": {
        ...seedPricingState(job()),
        mode: "fixed_package",
        packageText: "",
      },
    });
    const totals = computeWorkspaceTotals(drafts);
    expect(workspacePresentationBlockers(drafts, totals)).toContain(
      "ESTIMATE_MISSING_PRICES"
    );
  });
});

describe("chips", () => {
  it("derives the work-progress chip from the legacy status facets", () => {
    expect(workProgressChip("draft")).toEqual({ label: "Planned", tone: "muted" });
    expect(workProgressChip("in_progress")).toEqual({
      label: "In progress",
      tone: "orange",
    });
    expect(workProgressChip("ready_to_start")).toEqual({
      label: "Ready",
      tone: "teal",
    });
    expect(workProgressChip("completed")).toEqual({
      label: "Completed",
      tone: "muted",
    });
  });

  it("prefers live estimate decisions for the authorization chip", () => {
    expect(authorizationChip("draft", "approved", true).label).toBe("Approved");
    expect(authorizationChip("approved", "declined", true).label).toBe("Declined");
    expect(authorizationChip("draft", null, true).label).toBe("Pending decision");
  });

  it("falls back to legacy status facets off the presented version", () => {
    expect(authorizationChip("approved", null, false).label).toBe("Approved");
    expect(authorizationChip("declined", null, false).label).toBe("Declined");
    expect(authorizationChip("waiting_for_approval", null, false).label).toBe(
      "Pending decision"
    );
    expect(authorizationChip("draft", null, false).label).toBe("Draft — not presented");
  });
});

describe("decisions and amendments", () => {
  it("requires a decision for every presented job", () => {
    expect(decisionsComplete(["a", "b"], { a: "approved" })).toBe(false);
    expect(decisionsComplete(["a", "b"], { a: "approved", b: "declined" })).toBe(true);
    expect(decisionsComplete([], {})).toBe(false);
  });

  it("serializes only recorded decisions", () => {
    expect(toDecisionList(["a", "b"], { a: "approved" })).toEqual([
      { jobId: "a", decision: "approved" },
    ]);
  });

  it("announces the amendment version after edits to a presented estimate", () => {
    const live = { version_no: 2, status: "presented" };
    expect(amendmentNotice(live, false)).toBeNull();
    expect(amendmentNotice(live, true)).toContain("will create version 3");
    expect(amendmentNotice({ version_no: 1, status: "draft" }, true)).toBeNull();
    expect(amendmentNotice(null, true)).toBeNull();
  });
});
