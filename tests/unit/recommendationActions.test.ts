import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  getDraft: vi.fn(),
  create: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/services/recommendations", () => ({
  approveRecommendationAndSendToFloor: vi.fn(),
  convertRecommendationToJob: vi.fn(),
  createRecommendation: mocks.create,
  getInspectionRecommendationDraft: mocks.getDraft,
  listOutstandingRecommendationsForMotorcycle: vi.fn(),
  saveRecommendationFromInspectionResult: mocks.save,
  updateRecommendationStatus: vi.fn(),
}));

import {
  createRecommendationAction,
  getInspectionRecommendationDraftAction,
  saveInspectionRecommendationAction,
} from "@/app/(app)/work_orders/recommendation-actions";

describe("saveInspectionRecommendationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the linked inspection recommendation and reports success", async () => {
    mocks.save.mockResolvedValue({
      recommendation_id: "recommendation-1",
      work_order_id: "work-order-verified",
    });
    const formData = new FormData();
    formData.set("description", "Front brake pads");
    formData.set("severity", "immediate_attention");
    formData.set("notes", "Replace now");

    const result = await saveInspectionRecommendationAction(
      "work-order-1",
      "inspection-result-1",
      { error: null },
      formData
    );

    expect(mocks.save).toHaveBeenCalledWith("work-order-1", "inspection-result-1", {
      description: "Front brake pads",
      severity: "immediate_attention",
      notes: "Replace now",
    });
    expect(result).toEqual({ error: null, saved: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/work_orders/work-order-verified/inspection"
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith(
      "/work_orders/work-order-1/inspection"
    );
  });

  it("passes the expected work order into the draft loader service", async () => {
    mocks.getDraft.mockResolvedValue({
      description: "Front brake pads",
      severity: "immediate_attention",
      notes: "Replace now",
    });

    await expect(
      getInspectionRecommendationDraftAction("work-order-1", "inspection-result-1")
    ).resolves.toEqual({
      draft: {
        description: "Front brake pads",
        severity: "immediate_attention",
        notes: "Replace now",
      },
      error: null,
    });
    expect(mocks.getDraft).toHaveBeenCalledWith("work-order-1", "inspection-result-1");
  });

  it.each([
    [
      "INSPECTION_RECOMMENDATION_MISSING",
      "The automatic recommendation is missing or withdrawn. Re-flag this inspection item and try again.",
    ],
    [
      "RECOMMENDATION_ALREADY_ACTIONED",
      "This recommendation has already been acted on and can no longer be edited.",
    ],
    ["FORBIDDEN", "You do not have permission to perform this action."],
  ])(
    "maps %s before a production Server Action boundary can redact it",
    async (code, message) => {
      mocks.getDraft.mockRejectedValue(new Error(code));

      await expect(
        getInspectionRecommendationDraftAction("work-order-1", "inspection-result-1")
      ).resolves.toEqual({
        draft: null,
        error: message,
      });
    }
  );

  it("keeps the older create action inspection branch bound to the verified work order", async () => {
    mocks.save.mockResolvedValue({
      recommendation_id: "recommendation-1",
      work_order_id: "work-order-1",
    });
    const formData = new FormData();
    formData.set("inspection_result_id", "inspection-result-1");
    formData.set("description", "Front brake pads");
    formData.set("severity", "future_attention");
    formData.set("notes", "Plan next visit");

    await expect(
      createRecommendationAction("work-order-1", { error: null }, formData)
    ).resolves.toEqual({ error: null });

    expect(mocks.save).toHaveBeenCalledWith("work-order-1", "inspection-result-1", {
      description: "Front brake pads",
      severity: "future_attention",
      notes: "Plan next visit",
    });
  });

  it("does not revalidate a supplied work order when ownership validation fails", async () => {
    mocks.save.mockRejectedValue(new Error("INSPECTION_RESULT_NOT_FOUND"));

    const result = await saveInspectionRecommendationAction(
      "wrong-work-order",
      "inspection-result-1",
      { error: null },
      new FormData()
    );

    expect(result).toEqual({
      error: "That inspection result no longer exists.",
      saved: false,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the modal open when the recommendation was already acted on", async () => {
    mocks.save.mockRejectedValue(new Error("RECOMMENDATION_ALREADY_ACTIONED"));

    const result = await saveInspectionRecommendationAction(
      "work-order-1",
      "inspection-result-1",
      { error: null },
      new FormData()
    );

    expect(result).toEqual({
      error: "This recommendation has already been acted on and can no longer be edited.",
      saved: false,
    });
  });

  it("returns the named re-flag error when the automatic link is missing", async () => {
    mocks.save.mockRejectedValue(new Error("INSPECTION_RECOMMENDATION_MISSING"));

    const result = await saveInspectionRecommendationAction(
      "work-order-1",
      "inspection-result-1",
      { error: null },
      new FormData()
    );

    expect(result).toEqual({
      error:
        "The automatic recommendation is missing or withdrawn. Re-flag this inspection item and try again.",
      saved: false,
    });
  });
});
