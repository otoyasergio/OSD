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

  it("intake forms wait on the durable queue instead of uploading inline", () => {
    for (const relativePath of [
      "components/forms/CreateWorkOrderForm.tsx",
      "components/forms/IntakePhotoRecoveryForm.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).toMatch(/waitForConfirmations|attachAndWaitForRequiredIntakePhotos/);
      expect(source).not.toMatch(/uploadSelectedIntakePhoto/);
    }
  });
});

describe("photo compression runs off the main thread on Safari, iOS and Chrome", () => {
  // Safari encodes canvas.toBlob synchronously on the main thread (~300 ms per
  // 12 MP JPEG, several encodes per photo), freezing the form on iPad/iPhone.
  it("spawns the worker with the literal shape webpack and Turbopack bundle", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/forms/compressImageWorker.ts"),
      "utf8"
    );
    expect(source).toMatch(
      /new Worker\(\s*new URL\(\s*"\.\/compressImage\.worker\.ts",\s*import\.meta\.url\s*\)\s*\)/
    );
  });

  it("keeps the worker entry free of DOM-only modules", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/forms/compressImage.worker.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/compressImageForUpload|compressImageWorker"|document\./);
    expect(source).toMatch(/compressWithOffscreenCanvas/);
  });

  it("tries the worker before the <canvas> element path", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/forms/compressImageForUpload.ts"),
      "utf8"
    );
    const workerCall = source.indexOf("compressInWorker(file, resolved)");
    const mainThreadCall = source.indexOf("compressOnMainThread(file, resolved)");
    expect(workerCall).toBeGreaterThan(-1);
    expect(mainThreadCall).toBeGreaterThan(workerCall);
  });
});

describe("multi-photo forms never put more than one photo in a Server Action body", () => {
  // Vercel refuses request bodies over 4.5 MB before the action runs, so any
  // form that submits several camera photos at once fails deterministically.
  it("technician floor after-photos enqueue one durable upload per photo", () => {
    const shell = readFileSync(
      join(process.cwd(), "components/technician/TechnicianFloorShell.tsx"),
      "utf8"
    );
    const field = readFileSync(
      join(process.cwd(), "components/technician/FloorPhotoField.tsx"),
      "utf8"
    );
    expect(field).toMatch(/queue\.enqueue/);
    expect(field).toMatch(/exceedsServerActionUploadLimit/);
    expect(shell).not.toMatch(/useActionState\(\s*uploadJobProofAction/);
    expect(shell).not.toMatch(/uploadPhotosIndividually/);
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
