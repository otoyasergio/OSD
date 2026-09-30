import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  addAuditLog,
  addTimelineEvent,
  createClient,
  ensureRecommendations,
  recalculateWorkOrderStatus,
  removeInspectionSignature,
  requireUser,
  uploadInspectionSignature,
} = vi.hoisted(() => ({
  addAuditLog: vi.fn(),
  addTimelineEvent: vi.fn(),
  createClient: vi.fn(),
  ensureRecommendations: vi.fn(),
  recalculateWorkOrderStatus: vi.fn(),
  removeInspectionSignature: vi.fn(),
  requireUser: vi.fn(),
  uploadInspectionSignature: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/audit/addAuditLog", () => ({ addAuditLog }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));
vi.mock("@/lib/status/recalculateWorkOrderStatus", () => ({
  recalculateWorkOrderStatus,
}));
vi.mock("@/lib/services/inspectionSignatures", () => ({
  uploadInspectionSignature,
  removeInspectionSignature,
}));
vi.mock("@/lib/services/recommendations", () => ({
  ensureRecommendationsForAttentionFindings: ensureRecommendations,
}));

import { completeInspection } from "@/lib/services/inspections";

const WO = "41111111-1111-4111-8111-111111111111";
const INSPECTION = "e1111111-1111-4111-8111-111111111111";
const USER = "11111111-1111-4111-8111-111111111111";
const LOCATION = "31111111-1111-4111-8111-111111111111";

function client() {
  const from = vi.fn((table: string) => {
    if (table === "work_order") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                work_order_id: WO,
                location_id: LOCATION,
                work_order_number: "WO-100",
                status: "inspection_in_progress",
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "inspection") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                inspection_id: INSPECTION,
                started_at: "2026-09-29T00:00:00.000Z",
                completed_at: null,
                inspection_result: [
                  {
                    inspection_result_id: "f1111111-1111-4111-8111-111111111111",
                    status: "ok",
                    category_snapshot: "Brakes",
                    item_name_snapshot: "Front brake",
                    notes: null,
                  },
                ],
              },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    }
    if (table === "intake_photo") {
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return { from };
}

describe("completeInspection return contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      user_id: USER,
      role: "technician",
      status: "active",
      active_location_id: LOCATION,
      location_ids: [LOCATION],
    });
    createClient.mockResolvedValue(client());
    uploadInspectionSignature.mockResolvedValue("inspection/signature.png");
    ensureRecommendations.mockResolvedValue(0);
    recalculateWorkOrderStatus.mockResolvedValue(undefined);
  });

  it("returns the committed completion identity only after downstream work succeeds", async () => {
    const result = await completeInspection(WO, {
      signatureDataUrl: "data:image/png;base64,YQ==",
    });

    expect(result).toEqual({
      inspectionId: INSPECTION,
      completedAt: expect.stringMatching(/^20/),
      completedByUserId: USER,
    });
    expect(recalculateWorkOrderStatus).toHaveBeenCalledWith(expect.anything(), WO, USER);
  });

  it("does not return completion metadata when existing status work fails", async () => {
    recalculateWorkOrderStatus.mockRejectedValue(new Error("status failed"));

    await expect(completeInspection(WO)).rejects.toThrow("status failed");
  });
});
