import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("secondary pickers use the shared iOS-safe prepared input", () => {
  it("Composer replaces hidden ref.click() with a native label and readPickedPhotoFiles", () => {
    const src = source("components/messages/Composer.tsx");
    expect(src).toMatch(/readPickedPhotoFiles/);
    expect(src).toMatch(/UNREADABLE_PHOTO_MESSAGE/);
    expect(src).toMatch(/htmlFor=/);
    expect(src).toMatch(/photo-file-input/);
    expect(src).toMatch(/image\/heic/);
    expect(src).toMatch(/className="relative"/);
    expect(src).toMatch(/disabled=\{pending\}/);
    expect(src).toMatch(/aria-disabled=\{pending\}/);
    expect(src).not.toMatch(/className="hidden"/);
    expect(src).not.toMatch(/fileInputRef\.current\?\.click\(/);
    expect(src).not.toMatch(/\.click\(\)/);
  });

  it("ProfilePhotoForm accepts HEIC and prepares through PreparedFileInput before the form action", () => {
    const src = source("components/forms/ProfilePhotoForm.tsx");
    expect(src).toMatch(/PreparedFileInput/);
    expect(src).toMatch(/image\/heic/);
    expect(src).toMatch(/image\/heif/);
    expect(src).toMatch(/name="file"|name=\{"file"\}/);
    expect(src).toMatch(/onPreparingChange/);
    expect(src).toMatch(/disabled=\{preparing\}/);
    expect(src).not.toMatch(/\.click\(\)/);
    expect(src).not.toMatch(/display:\s*none|\.hidden\b|sr-only/);
  });

  it("CustomerDocuments clones PDFs and prepares images, including HEIC source", () => {
    const src = source("components/customers/CustomerDocuments.tsx");
    expect(src).toMatch(
      /PreparedFileInput|readPickedUploadFiles|preparePickedFileForUpload/
    );
    expect(src).toMatch(/image\/heic/);
    expect(src).toMatch(/application\/pdf/);
    expect(src).toMatch(/photo-file-input|PreparedFileInput/);
    expect(src).toMatch(/onPreparingChange/);
    expect(src).toMatch(/setPreparedFile\(null\)|setFile\(null\)/);
    expect(src).toMatch(/disabled=\{pending \|\| preparing\}/);
    expect(src).not.toMatch(/setFile\(e\.target\.files/);
    expect(src).not.toMatch(/\.click\(\)/);
  });

  it("StaffProfileForms uses the shared prepared picker for PDF and HEIC images", () => {
    const src = source("components/settings/StaffProfileForms.tsx");
    expect(src).toMatch(/PreparedFileInput/);
    expect(src).toMatch(/image\/heic/);
    expect(src).toMatch(/application\/pdf/);
    expect(src).toMatch(/name="file"|name=\{"file"\}/);
    expect(src).toMatch(/onPreparingChange/);
    expect(src).toMatch(/disabled=\{preparing\}/);
    expect(src).not.toMatch(/\.click\(\)/);
    expect(src).not.toMatch(/sr-only|className="hidden"/);
  });

  it("MotorcycleDocuments keeps label activation and drops sr-only for photo-file-input", () => {
    const src = source("components/motorcycles/MotorcycleDocuments.tsx");
    expect(src).toMatch(/readPickedPhotoFiles/);
    expect(src).toMatch(/htmlFor=\{cameraInputId\}/);
    expect(src).toMatch(/htmlFor=\{libraryInputId\}/);
    expect(src).toMatch(/className="photo-file-input"/);
    expect(src).not.toMatch(/className="sr-only"/);
    expect(src).not.toMatch(/\.click\(\)/);
  });
});
