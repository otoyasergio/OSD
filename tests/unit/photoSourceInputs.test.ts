import { describe, expect, it } from "vitest";
import { CAMERA_ROLL_HINT, photoFileInputProps } from "@/lib/forms/photoSourceInputs";

describe("photoFileInputProps", () => {
  it("camera source requests rear capture so mobile opens the camera", () => {
    const props = photoFileInputProps("camera");
    expect(props.accept).toContain("image/*");
    expect(props.capture).toBe("environment");
  });

  it("library source omits capture so Safari shows the photo library", () => {
    const props = photoFileInputProps("library");
    expect(props.accept.startsWith("image/*")).toBe(true);
    expect(props).not.toHaveProperty("capture");
  });

  it("tells staff that camera shots are kept on the device", () => {
    expect(CAMERA_ROLL_HINT).toMatch(/photos/i);
  });

  it("camera accept leads with image/* for Safari photo pickers", () => {
    const props = photoFileInputProps("camera");
    expect(props.accept.startsWith("image/*")).toBe(true);
  });
});
