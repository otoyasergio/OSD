import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/services/recommendations", () => ({
  approveRecommendationAndSendToFloor: vi.fn(),
  convertRecommendationToJob: vi.fn(),
  createRecommendation: vi.fn(),
  listOutstandingRecommendationsForMotorcycle: vi.fn(),
  saveRecommendationFromInspectionResult: mocks.save,
  updateRecommendationStatus: vi.fn(),
}));

import { saveInspectionRecommendationAction } from "@/app/(app)/work_orders/recommendation-actions";

describe("saveInspectionRecommendationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the linked inspection recommendation and reports success", async () => {
    mocks.save.mockResolvedValue({ recommendation_id: "recommendation-1" });
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

    expect(mocks.save).toHaveBeenCalledWith("inspection-result-1", {
      description: "Front brake pads",
      severity: "immediate_attention",
      notes: "Replace now",
    });
    expect(result).toEqual({ error: null, saved: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/work_orders/work-order-1/inspection"
    );
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
});
