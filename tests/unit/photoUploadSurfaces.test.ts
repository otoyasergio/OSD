import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GENERAL_WORK_ORDER_PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
} from "@/lib/status/labels";

const PICKERS = [
  "components/forms/IntakePhotoSlots.tsx",
  "components/forms/OptionalIntakePhotos.tsx",
  "components/photos/PhotosTab.tsx",
  "components/technician/FloorPhotoField.tsx",
  "components/contracts/PaperAgreementCopyUpload.tsx",
  "components/messages/Composer.tsx",
  "components/motorcycles/MotorcycleDocuments.tsx",
];

describe("general work-order photo categories", () => {
  it("excludes job and inspection categories that cannot be linked from Photos tab", () => {
    expect(GENERAL_WORK_ORDER_PHOTO_CATEGORIES).toContain("front");
    expect(GENERAL_WORK_ORDER_PHOTO_CATEGORIES).toContain("other");
    expect(GENERAL_WORK_ORDER_PHOTO_CATEGORIES).not.toContain("job_proof");
    expect(GENERAL_WORK_ORDER_PHOTO_CATEGORIES).not.toContain("job_work");
    expect(
      GENERAL_WORK_ORDER_PHOTO_CATEGORIES.filter((category) =>
        category.startsWith("inspection_")
      )
    ).toEqual([]);
    expect(GENERAL_WORK_ORDER_PHOTO_CATEGORIES.length).toBeLessThan(
      Object.keys(PHOTO_CATEGORY_LABELS).length
    );
  });
});

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
    expect(source).toMatch(/queue\.confirmations/);
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
    expect(source).toMatch(/applyPickedFile/);
    expect(source).toMatch(/subscribeConfirmation/);
    expect(source).toMatch(/categoryRef|notesRef/);
    expect(source).toMatch(/GENERAL_WORK_ORDER_PHOTO_CATEGORIES/);
    expect(source).not.toMatch(/pendingFile/);
    expect(source).not.toMatch(/DataTransfer/);
    expect(source).not.toMatch(/useActionState\(uploadAction/);
  });

  it("floor photo field enqueues job_proof or job_work and surfaces unreadable files", () => {
    const source = readFileSync(
      join(process.cwd(), "components/technician/FloorPhotoField.tsx"),
      "utf8"
    );
    expect(source).toMatch(/queue\.enqueue/);
    expect(source).toMatch(/queue\.confirmations/);
    expect(source).toMatch(/UNREADABLE_PHOTO_MESSAGE/);
    expect(source).toMatch(/workOrderId/);
    expect(source).toMatch(/jobId/);
    expect(source).not.toMatch(/ownedQueueIds/);
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

  it("floor shell no longer keeps unused proof action pending state", () => {
    const source = readFileSync(
      join(process.cwd(), "components/technician/TechnicianFloorShell.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/uploadJobProofAction/);
    expect(source).not.toMatch(/proofPending/);
    expect(source).not.toMatch(/proofState/);
  });

  it("diagnostics picker enqueues and selects a saved confirmation once", () => {
    const source = readFileSync(
      join(process.cwd(), "components/diagnostics/DiagnosticsPhotoPicker.tsx"),
      "utf8"
    );
    expect(source).toMatch(/queue\.enqueue/);
    expect(source).toMatch(/assistantThreadId/);
    expect(source).toMatch(/subscribeConfirmation/);
    expect(source).toMatch(/usePhotoUploadQueue/);
    expect(source).toMatch(/htmlFor=\{cameraInputId\}/);
    expect(source).toMatch(/htmlFor=\{libraryInputId\}/);
    expect(source).not.toMatch(/useOptionalPhotoUploadQueue/);
    expect(source).not.toMatch(/\.click\(\)/);
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
