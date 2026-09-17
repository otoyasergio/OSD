import { describe, expect, it } from "vitest";
import {
  buildVisitWorkList,
  jobAuthorizationLabel,
  jobWorkLabel,
  normalizeJobOrigin,
} from "@/lib/work-orders/visitWorkList";
import {
  parseSignatureDataUrl,
  inspectionSignatureStoragePath,
} from "@/lib/services/inspectionSignatures";

describe("visitWorkList", () => {
  it("normalizes unknown origin to shop_added", () => {
    expect(normalizeJobOrigin(null)).toBe("shop_added");
    expect(normalizeJobOrigin("customer_request")).toBe("customer_request");
  });

  it("splits authorization from work progress", () => {
    expect(jobAuthorizationLabel("approved")).toBe("Approved");
    expect(jobWorkLabel("approved")).toBe("Not started");
    expect(jobWorkLabel("in_progress")).toBe("In progress");
    expect(jobWorkLabel("completed")).toBe("Done");
  });

  it("buckets asked / recommended / tech does this / not doing", () => {
    const list = buildVisitWorkList({
      jobs: [
        {
          job_id: "1",
          service_name_snapshot: "Oil change",
          status: "approved",
          origin: "customer_request",
          notes: "Customer said ticks",
        },
        {
          job_id: "2",
          service_name_snapshot: "Brake pads",
          status: "waiting_for_approval",
          origin: "recommendation",
          notes: null,
        },
        {
          job_id: "3",
          service_name_snapshot: "Chain clean",
          status: "in_progress",
          origin: "recommendation",
          notes: null,
        },
        {
          job_id: "4",
          service_name_snapshot: "Declined work",
          status: "declined",
          origin: "shop_added",
          notes: null,
        },
      ],
      openRecommendations: [
        {
          recommendation_id: "r1",
          description: "Fork seals",
          status: "pending",
          severity: "immediate_attention",
        },
      ],
    });

    expect(list.customerAsked.map((i) => i.title)).toEqual(["Oil change"]);
    expect(list.customerAsked[0]?.notes).toBe("Customer said ticks");
    expect(list.recommended.map((i) => i.title)).toEqual(["Brake pads", "Fork seals"]);
    expect(list.techDoesThis.map((i) => i.title)).toEqual(["Oil change", "Chain clean"]);
    expect(list.notDoing.map((i) => i.title)).toEqual(["Declined work"]);
  });
});

describe("inspectionSignatures", () => {
  it("rejects empty and invalid data URLs", () => {
    expect(() => parseSignatureDataUrl("")).toThrow("SIGNATURE_INVALID");
    expect(() => parseSignatureDataUrl("not-an-image")).toThrow("SIGNATURE_INVALID");
  });

  it("parses a tiny PNG data URL", () => {
    const tiny =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const parsed = parseSignatureDataUrl(tiny);
    expect(parsed.ext).toBe("png");
    expect(parsed.bytes.length).toBeGreaterThan(0);
  });

  it("builds storage paths with kind", () => {
    const path = inspectionSignatureStoragePath({
      locationId: "loc",
      workOrderId: "wo",
      kind: "final",
      ext: "png",
    });
    expect(path).toMatch(/^loc\/wo\/final\/.+\.png$/);
  });
});
