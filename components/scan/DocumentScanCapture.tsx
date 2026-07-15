"use client";

import { useRef, useState, useTransition } from "react";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import { parseAamvaBarcode, type AamvaCustomerDraft } from "@/lib/scan/aamva";
import { parseOwnershipText, type OwnershipDraft } from "@/lib/scan/ownershipText";
import { FormError } from "@/components/forms/Field";

export type CustomerScanResult = AamvaCustomerDraft;
export type MotorcycleScanResult = OwnershipDraft;

type Props =
  | {
      mode: "driver_license";
      onConfirm: (draft: CustomerScanResult) => void;
    }
  | {
      mode: "ownership";
      onConfirm: (draft: MotorcycleScanResult) => void;
    };

async function decodeBarcodeFromImage(
  file: File
): Promise<string | null> {
  // Prefer BarcodeDetector when available (feature-detect for Safari).
  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    try {
      // @ts-expect-error BarcodeDetector is not in all TS lib versions
      const detector = new window.BarcodeDetector({
        formats: ["pdf417", "qr_code", "code_128", "data_matrix"],
      });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      if (codes?.[0]?.rawValue) return String(codes[0].rawValue);
    } catch {
      // fall through
    }
  }

  try {
    const { BrowserPDF417Reader } = await import("@zxing/browser");
    const reader = new BrowserPDF417Reader();
    const url = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(url);
      return result.getText();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

async function ocrImage(file: File): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(file);
    return text;
  } finally {
    await worker.terminate();
  }
}

/**
 * Optional Safari-safe document capture + parse with confirm-before-apply.
 */
export function DocumentScanCapture(props: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [customerDraft, setCustomerDraft] = useState<CustomerScanResult | null>(
    null
  );
  const [bikeDraft, setBikeDraft] = useState<MotorcycleScanResult | null>(null);
  const [saveDocumentCopy, setSaveDocumentCopy] = useState(false);

  function reset() {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFile(null);
    setError(null);
    setCustomerDraft(null);
    setBikeDraft(null);
    setSaveDocumentCopy(false);
  }

  function onFile(next: File | null) {
    reset();
    if (!next) return;
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
  }

  function parseSelected() {
    if (!file) {
      setError("Choose a photo first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        if (props.mode === "driver_license") {
          const barcode = await decodeBarcodeFromImage(file);
          if (!barcode) {
            setError("Could not read barcode — enter manually.");
            return;
          }
          const draft = parseAamvaBarcode(barcode);
          if (!draft) {
            setError("Could not read barcode — enter manually.");
            return;
          }
          setCustomerDraft(draft);
          return;
        }

        const text = await ocrImage(file);
        const draft = parseOwnershipText(text);
        if (!draft.vin && !draft.year && !draft.make) {
          setError("Could not read ownership details — enter manually.");
          setBikeDraft(draft);
          return;
        }
        setBikeDraft(draft);
      } catch {
        setError("Could not read document — enter manually.");
      }
    });
  }

  function confirm() {
    if (props.mode === "driver_license" && customerDraft) {
      props.onConfirm({
        ...customerDraft,
        raw_notes: saveDocumentCopy
          ? `${customerDraft.raw_notes ?? ""}\n[Save document copy requested]`.trim()
          : customerDraft.raw_notes,
      });
      setOpen(false);
      reset();
      return;
    }
    if (props.mode === "ownership" && bikeDraft) {
      props.onConfirm(bikeDraft);
      setOpen(false);
      reset();
    }
  }

  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");
  const label =
    props.mode === "driver_license"
      ? "Scan driver license"
      : "Scan ownership / registration";

  return (
    <div className="document-scan">
      <button
        type="button"
        className="btn btn-secondary min-h-11"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide scan" : label}
      </button>

      {open ? (
        <div className="mt-3 flex flex-col gap-3 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--status-neutral)]">
            Optional. Photos stay on this device until you confirm. By scanning,
            you consent to reading the document to fill the form — review before
            saving.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary min-h-11"
              onClick={() => cameraRef.current?.click()}
            >
              Camera
            </button>
            <button
              type="button"
              className="btn btn-secondary min-h-11"
              onClick={() => libraryRef.current?.click()}
            >
              Photo library
            </button>
            <input
              ref={cameraRef}
              type="file"
              className="sr-only"
              accept={cameraProps.accept}
              capture={cameraProps.capture}
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            <input
              ref={libraryRef}
              type="file"
              className="sr-only"
              accept={libraryProps.accept}
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Document preview"
              className="max-h-48 w-auto rounded border border-[var(--border)] object-contain"
            />
          ) : null}

          <button
            type="button"
            className="btn btn-primary min-h-11 self-start"
            disabled={!file || pending}
            onClick={parseSelected}
          >
            {pending ? "Reading…" : "Parse document"}
          </button>

          <FormError message={error} />

          {props.mode === "driver_license" && customerDraft ? (
            <ConfirmCustomer
              draft={customerDraft}
              onChange={setCustomerDraft}
              saveDocumentCopy={saveDocumentCopy}
              onSaveDocumentCopy={setSaveDocumentCopy}
              onConfirm={confirm}
            />
          ) : null}

          {props.mode === "ownership" && bikeDraft ? (
            <ConfirmBike draft={bikeDraft} onChange={setBikeDraft} onConfirm={confirm} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConfirmCustomer({
  draft,
  onChange,
  saveDocumentCopy,
  onSaveDocumentCopy,
  onConfirm,
}: {
  draft: CustomerScanResult;
  onChange: (d: CustomerScanResult) => void;
  saveDocumentCopy: boolean;
  onSaveDocumentCopy: (v: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-3">
      <p className="font-semibold">Confirm details</p>
      <label className="block">
        <span className="field-label">First name</span>
        <input
          className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
          value={draft.first_name}
          onChange={(e) => onChange({ ...draft, first_name: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="field-label">Last name</span>
        <input
          className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
          value={draft.last_name}
          onChange={(e) => onChange({ ...draft, last_name: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="field-label">Notes (license / address)</span>
        <textarea
          className="min-h-20 w-full rounded border border-[var(--border-strong)] px-3 py-2"
          value={draft.raw_notes ?? ""}
          onChange={(e) => onChange({ ...draft, raw_notes: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={saveDocumentCopy}
          onChange={(e) => onSaveDocumentCopy(e.target.checked)}
        />
        Save document copy to customer documents (off by default)
      </label>
      <button type="button" className="btn btn-primary min-h-11 self-start" onClick={onConfirm}>
        Apply to form
      </button>
    </div>
  );
}

function ConfirmBike({
  draft,
  onChange,
  onConfirm,
}: {
  draft: MotorcycleScanResult;
  onChange: (d: MotorcycleScanResult) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-3">
      <p className="font-semibold">Confirm details</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">Year</span>
          <input
            className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
            value={draft.year ?? ""}
            onChange={(e) =>
              onChange({
                ...draft,
                year: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </label>
        <label className="block">
          <span className="field-label">Make</span>
          <input
            className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
            value={draft.make ?? ""}
            onChange={(e) => onChange({ ...draft, make: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="field-label">Model</span>
          <input
            className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
            value={draft.model ?? ""}
            onChange={(e) => onChange({ ...draft, model: e.target.value })}
          />
        </label>
      </div>
      <label className="block">
        <span className="field-label">VIN</span>
        <input
          className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3 font-mono"
          value={draft.vin ?? ""}
          onChange={(e) => onChange({ ...draft, vin: e.target.value })}
        />
      </label>
      <button type="button" className="btn btn-primary min-h-11 self-start" onClick={onConfirm}>
        Apply to form
      </button>
    </div>
  );
}
