import { describe, expect, it } from "vitest";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";

describe("photoFileInputProps", () => {
  it("camera source requests rear capture so mobile opens the camera", () => {
    const props = photoFileInputProps("camera");
    expect(props.accept).toContain("image/*");
    expect(props.capture).toBe("environment");
  });

  it("library source omits capture so Safari shows the photo library", () => {
    const props = photoFileInputProps("library");
    expect(props.accept).toContain("image/*");
    expect(props).not.toHaveProperty("capture");
  });
});
