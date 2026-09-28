import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PICKERS = [
  "components/forms/IntakePhotoSlots.tsx",
  "components/forms/OptionalIntakePhotos.tsx",
  "components/photos/PhotosTab.tsx",
  "components/technician/FloorPhotoField.tsx",
  "components/contracts/PaperAgreementCopyUpload.tsx",
  "components/messages/Composer.tsx",
  "components/motorcycles/MotorcycleDocuments.tsx",
];

describe("photo upload surfaces clone files before clearing the picker", () => {
  it.each(PICKERS)("%s prepares files before upload", (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    expect(source).toMatch(/readPickedPhotoFiles|preparePhotoFileForUpload/);
  });

  it("floor photo buttons activate inputs with labels, not click()", () => {
    const source = readFileSync(
      join(process.cwd(), "components/technician/FloorPhotoField.tsx"),
      "utf8"
    );
    expect(source).toMatch(/htmlFor=\{cameraInputId\}/);
    expect(source).toMatch(/htmlFor=\{libraryInputId\}/);
    expect(source).not.toMatch(/pit-photo-add[\s\S]*onClick=\{\(\) => cameraInputRef/);
  });

  it("lightbox offers save-to-device for the open photo", () => {
    const source = readFileSync(
      join(process.cwd(), "components/photos/PhotoLightbox.tsx"),
      "utf8"
    );
    expect(source).toMatch(/saveRemotePhotoToCameraRoll/);
    expect(source).toMatch(/Save photo to this device/);
  });

  it("intake sequential uploads clone/compress then retry transient failures", () => {
    const source = readFileSync(
      join(process.cwd(), "components/forms/intakePhotoUploadClient.ts"),
      "utf8"
    );
    expect(source).toMatch(/preparePhotoFileForUpload/);
    expect(source).toMatch(/withPhotoUploadRetries/);
  });
});
