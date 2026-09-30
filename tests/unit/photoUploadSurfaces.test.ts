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

  it("inspection photos upload one at a time and preview before the server returns", () => {
    const source = readFileSync(
      join(process.cwd(), "components/inspections/InspectionPhotoSlot.tsx"),
      "utf8"
    );
    expect(source).toMatch(/readPickedPhotoFiles/);
    expect(source).toMatch(/withPhotoUploadRetries/);
    expect(source).toMatch(/createObjectURL/);
    expect(source).toMatch(/router\.refresh\(\)/);
    expect(source).toMatch(/Ask OTOMOTO/);
    expect(source).not.toMatch(/formData\.append\("file"/);
  });

  it("inspection report reuses stable signed photo URLs", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/services/inspections.ts"),
      "utf8"
    );
    expect(source).toMatch(/signStoragePaths/);
    expect(source).not.toMatch(/createSignedUrls/);
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
    expect(source).toMatch(/exceedsServerActionUploadLimit/);
    expect(source).toMatch(/describePhotoUploadFailure/);
  });

  it("intake forms surface the specific upload failure, not just the category list", () => {
    for (const relativePath of [
      "components/forms/CreateWorkOrderForm.tsx",
      "components/forms/IntakePhotoRecoveryForm.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).toMatch(/intakePhotoFailureMessage/);
    }
  });
});

describe("multi-photo forms never put more than one photo in a Server Action body", () => {
  // Vercel refuses request bodies over 4.5 MB before the action runs, so any
  // form that submits several camera photos at once fails deterministically.
  it("technician floor after-photos upload one request per photo", () => {
    const source = readFileSync(
      join(process.cwd(), "components/technician/TechnicianFloorShell.tsx"),
      "utf8"
    );
    expect(source).toMatch(/uploadPhotosIndividually/);
    expect(source).not.toMatch(/useActionState\(\s*uploadJobProofAction/);
  });

  it("motorcycle documents upload one request per document", () => {
    const source = readFileSync(
      join(process.cwd(), "components/motorcycles/MotorcycleDocuments.tsx"),
      "utf8"
    );
    expect(source).toMatch(/uploadPhotosIndividually/);
    expect(source).not.toMatch(/formData\.append\("file"/);
  });

  it("single-photo surfaces refuse oversize files before sending", () => {
    for (const relativePath of [
      "components/inspections/InspectionPhotoSlot.tsx",
      "components/photos/PhotosTab.tsx",
      "components/messages/Composer.tsx",
      "components/diagnostics/DiagnosticsPhotoPicker.tsx",
      "components/contracts/PaperAgreementCopyUpload.tsx",
      "components/forms/ProfilePhotoForm.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).toMatch(/exceedsServerActionUploadLimit/);
    }
  });
});
