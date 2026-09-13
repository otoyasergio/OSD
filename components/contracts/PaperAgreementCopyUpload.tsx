"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CameraIcon, LibraryIcon } from "@/components/forms/IntakePhotoSlots";
import { FormError } from "@/components/forms/Field";
import { DOCUMENT_IMAGE_COMPRESS } from "@/lib/forms/compressImageForUpload";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { cloneFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";
import { withIntakeFollowUp } from "@/lib/forms/intakeCompletion";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";

type Props = {
  action: (formData: FormData) => Promise<{ error: string | null }>;
  continueHref?: string;
};

const FILE_ACCEPT =
  "application/pdf,image/*,image/jpeg,image/png,image/webp,image/heic,image/heif";

export function PaperAgreementCopyUpload({ action, continueHref }: Props) {
  const router = useRouter();
  const titleId = useId();
  const cameraInputId = `${useId()}-paper-camera`;
  const fileInputId = `${useId()}-paper-file`;
  const [chooserOpen, setChooserOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cameraProps = photoFileInputProps("camera");

  function chooseFile(next: File | null) {
    setFile(next);
    setError(null);
    setChooserOpen(false);
  }

  async function chooseFromInput(input: HTMLInputElement) {
    const original = input.files?.[0] ?? null;
    setChooserOpen(false);
    setError(null);
    if (!original) {
      input.value = "";
      return;
    }
    try {
      if (original.type === "application/pdf" || !original.type.startsWith("image/")) {
        const cloned = await cloneFileForUpload(original);
        input.value = "";
        chooseFile(cloned);
        return;
      }
      const files = await readPickedPhotoFiles(input, DOCUMENT_IMAGE_COMPRESS);
      chooseFile(files[0] ?? null);
    } catch {
      input.value = "";
      setError(UNREADABLE_PHOTO_MESSAGE);
    }
  }

  function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose a photo or PDF of the signed paper agreement.");
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await action(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setFile(null);
      if (continueHref) {
        router.push(continueHref);
      }
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={upload}
      className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4"
    >
      <div>
        <p className="font-semibold text-foreground">Attach the signed paper copy</p>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Photograph it with this device or choose an image or PDF. This is optional.
        </p>
      </div>

      <FormError message={error} />

      {file ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--border)] bg-white px-3 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-[var(--status-neutral)]">
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary min-h-10 text-sm"
            disabled={pending}
            onClick={() => setChooserOpen(true)}
          >
            Change
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-secondary min-h-12 self-start"
          disabled={pending}
          onClick={() => setChooserOpen(true)}
        >
          Photograph or choose copy
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {file ? (
          <button type="submit" className="btn btn-primary min-h-12" disabled={pending}>
            {pending ? "Uploading…" : "Upload signed copy"}
          </button>
        ) : null}
        {continueHref ? (
          <Link
            href={withIntakeFollowUp(continueHref, "paper_copy")}
            className="btn btn-secondary min-h-12"
          >
            Skip for now
          </Link>
        ) : null}
      </div>

      {continueHref ? (
        <p className="text-sm text-[var(--status-neutral)]">
          You can attach the signed paper copy later from the work order.
        </p>
      ) : null}

      <input
        id={cameraInputId}
        className="photo-file-input"
        type="file"
        accept={cameraProps.accept}
        capture={cameraProps.capture}
        tabIndex={-1}
        disabled={pending}
        aria-label="Photograph signed paper agreement"
        onChange={(event) => {
          void chooseFromInput(event.currentTarget);
        }}
      />
      <input
        id={fileInputId}
        className="photo-file-input"
        type="file"
        accept={FILE_ACCEPT}
        tabIndex={-1}
        disabled={pending}
        aria-label="Choose signed paper agreement file"
        onChange={(event) => {
          void chooseFromInput(event.currentTarget);
        }}
      />

      {chooserOpen ? (
        <div
          className="photo-source-sheet"
          role="presentation"
          onClick={() => setChooserOpen(false)}
        >
          <div
            className="photo-source-sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <p id={titleId} className="photo-source-sheet-title">
              Attach signed paper copy
            </p>
            <p className="photo-source-sheet-lede">
              Take a photo now, or choose an image or PDF already on this device.
            </p>
            <label
              htmlFor={cameraInputId}
              className="btn btn-primary photo-source-sheet-action"
            >
              <CameraIcon />
              Camera
            </label>
            <label
              htmlFor={fileInputId}
              className="btn btn-secondary photo-source-sheet-action"
            >
              <LibraryIcon />
              Photo or PDF
            </label>
            <button
              type="button"
              className="btn btn-ghost photo-source-sheet-cancel"
              onClick={() => setChooserOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
