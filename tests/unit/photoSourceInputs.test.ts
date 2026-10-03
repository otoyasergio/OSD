import { describe, expect, it } from "vitest";
import {
  CAMERA_ROLL_HINT,
  DOCUMENT_FILE_ACCEPT,
  IMAGE_ACCEPT,
  photoFileInputProps,
} from "@/lib/forms/photoSourceInputs";

describe("shared Safari accept strings", () => {
  it("exports IMAGE_ACCEPT with an image/* prefix and HEIC types", () => {
    expect(IMAGE_ACCEPT.startsWith("image/*")).toBe(true);
    expect(IMAGE_ACCEPT).toContain("image/heic");
    expect(IMAGE_ACCEPT).toContain("image/heif");
  });

  it("keeps PDF first on the shared document accept string", () => {
    expect(DOCUMENT_FILE_ACCEPT).toBe(`application/pdf,${IMAGE_ACCEPT}`);
    expect(DOCUMENT_FILE_ACCEPT.startsWith("application/pdf,")).toBe(true);
    expect(DOCUMENT_FILE_ACCEPT).toContain("image/*");
  });
});

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
