"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { assignInputFiles } from "@/lib/forms/assignInputFiles";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { readPickedUploadFiles } from "@/lib/forms/readPickedUploadFiles";
import type { CompressImageOptions } from "@/lib/forms/compressImageForUpload";
import type { PhotoTelemetrySurface } from "@/lib/photos/telemetry";

export type PreparedFileInputProps = {
  id: string;
  name?: string;
  accept?: string;
  required?: boolean;
  disabled?: boolean;
  multiple?: boolean;
  capture?: "environment" | "user";
  surface: PhotoTelemetrySurface;
  compress?: CompressImageOptions;
  onPrepared?: (files: File[]) => void;
  onPreparingChange?: (preparing: boolean) => void;
};

export function PreparedFileInput({
  id,
  name,
  accept,
  required,
  disabled,
  multiple,
  capture,
  surface,
  compress,
  onPrepared,
  onPreparingChange,
}: PreparedFileInputProps) {
  const committedRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function beginPreparing(): void {
    if (committedRef.current) {
      assignInputFiles(committedRef.current, []);
      committedRef.current.disabled = true;
    }
    flushSync(() => {
      setPreparing(true);
      setFilename(null);
      setError(null);
      onPreparingChange?.(true);
    });
  }

  function finishPreparing(): void {
    if (committedRef.current) {
      committedRef.current.disabled = Boolean(disabled);
    }
    flushSync(() => {
      setPreparing(false);
      onPreparingChange?.(false);
    });
  }

  async function onPickerChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picker = event.currentTarget;
    beginPreparing();
    try {
      const files = await readPickedUploadFiles(picker, {
        surface,
        ...compress,
      });
      if (files.length === 0) {
        setFilename(null);
        return;
      }
      if (name && committedRef.current) {
        assignInputFiles(committedRef.current, files);
      }
      setFilename(files[0]?.name ?? null);
      onPrepared?.(files);
    } catch {
      if (committedRef.current) assignInputFiles(committedRef.current, []);
      setFilename(null);
      setError(UNREADABLE_PHOTO_MESSAGE);
    } finally {
      finishPreparing();
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="file"
        accept={accept}
        capture={capture}
        multiple={multiple}
        disabled={disabled || preparing}
        className="photo-file-input"
        tabIndex={-1}
        onChange={(event) => {
          void onPickerChange(event);
        }}
      />
      {name ? (
        <input
          ref={committedRef}
          type="file"
          name={name}
          required={required}
          disabled={disabled || preparing}
          className="photo-file-input"
          tabIndex={-1}
          aria-hidden
        />
      ) : null}
      {preparing ? (
        <p className="mt-1 text-sm text-[var(--status-neutral)]">Preparing…</p>
      ) : null}
      {filename && !preparing ? (
        <p className="mt-1 truncate text-sm text-foreground">{filename}</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-sm text-[var(--status-danger-fg)]">{error}</p>
      ) : null}
    </div>
  );
}
