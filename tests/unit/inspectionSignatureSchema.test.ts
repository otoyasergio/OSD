import { describe, it, expect } from "vitest";
import { completeInspectionSignatureSchema } from "@/lib/validation/schemas";

describe("completeInspectionSignatureSchema", () => {
  it("rejects missing signature", () => {
    expect(() =>
      completeInspectionSignatureSchema.parse({
        technician_signer_name: "Alex Tech",
        signature_data_url: "",
      })
    ).toThrow();
  });

  it("accepts png data url with name", () => {
    const parsed = completeInspectionSignatureSchema.parse({
      technician_signer_name: "Alex Tech",
      signature_data_url: "data:image/png;base64,aaa",
    });
    expect(parsed.technician_signer_name).toBe("Alex Tech");
  });
});
