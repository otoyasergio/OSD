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

  it("inspection photos enqueue and preview from the queue before the server returns", () => {
    const source = readFileSync(
      join(process.cwd(), "components/inspections/InspectionPhotoSlot.tsx"),
      "utf8"
    );
    expect(source).toMatch(/readPickedPhotoFiles/);
    expect(source).toMatch(/queue\.enqueue/);
    expect(source).toMatch(/previewUrl/);
    expect(source).toMatch(/subscribeConfirmation/);
    expect(source).toMatch(/router\.refresh\(\)/);
    expect(source).toMatch(/Ask OTOMOTO/);
    expect(source).toMatch(/Retry/);
    expect(source).not.toMatch(/uploadIntakePhotoAction/);
    expect(source).not.toMatch(/withPhotoUploadRetries/);
    expect(source).not.toMatch(/formData\.append\("file"/);
  });

  it("Photos tab enqueues instead of posting a DataTransfer form field", () => {
    const source = readFileSync(
      join(process.cwd(), "components/photos/PhotosTab.tsx"),
      "utf8"
    );
    expect(source).toMatch(/queue\.enqueue/);
    expect(source).toMatch(/clientUploadId|workOrderId/);
    expect(source).not.toMatch(/DataTransfer/);
    expect(source).not.toMatch(/useActionState\(uploadAction/);
  });

  it("floor photo field enqueues job_proof or job_work and surfaces unreadable files", () => {
    const source = readFileSync(
      join(process.cwd(), "components/technician/FloorPhotoField.tsx"),
      "utf8"
    );
    expect(source).toMatch(/queue\.enqueue/);
    expect(source).toMatch(/UNREADABLE_PHOTO_MESSAGE/);
    expect(source).toMatch(/workOrderId/);
    expect(source).toMatch(/jobId/);
    expect(source).not.toMatch(/useImperativeHandle/);
    expect(source).not.toMatch(/openCamera|openLibrary/);
    expect(source).not.toMatch(/name="file"/);
  });

  it("floor current step no longer posts photo bytes through uploadJobProofAction", () => {
    const source = readFileSync(
      join(process.cwd(), "components/technician/FloorCurrentStep.tsx"),
      "utf8"
    );
    expect(source).toMatch(/category="job_proof"/);
    expect(source).toMatch(/category="job_work"/);
    expect(source).not.toMatch(/action=\{proofAction\}/);
    expect(source).not.toMatch(/name="file"/);
  });

  it("diagnostics picker enqueues and selects a saved confirmation once", () => {
    const source = readFileSync(
      join(process.cwd(), "components/diagnostics/DiagnosticsPhotoPicker.tsx"),
      "utf8"
    );
    expect(source).toMatch(/queue\.enqueue/);
    expect(source).toMatch(/assistantThreadId/);
    expect(source).toMatch(/subscribeConfirmation/);
    expect(source).not.toMatch(/uploadAssistantPhotoAction/);
    expect(source).not.toMatch(/withPhotoUploadRetries/);
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

  it("retired intake client no longer orchestrates photo uploads", () => {
    const source = readFileSync(
      join(process.cwd(), "components/forms/intakePhotoUploadClient.ts"),
      "utf8"
    );
    expect(source).toMatch(/intakeContractHref/);
    expect(source).not.toMatch(/uploadIntakePhotoAction/);
    expect(source).not.toMatch(/preparePhotoFileForUpload/);
    expect(source).not.toMatch(/withPhotoUploadRetries/);
  });
});
