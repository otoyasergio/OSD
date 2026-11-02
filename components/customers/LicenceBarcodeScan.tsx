"use client";

import { useRef, useState } from "react";
import { parseAamvaLicence, type LicenceScan } from "@/lib/id/aamva";

type Props = {
  onConfirm: (scan: LicenceScan) => void;
};

/**
 * Safari reads the PDF417 on the back of an Ontario licence with the rear
 * camera. BarcodeDetector stays unused. A still frame is the fallback when
 * the live image misses.
 */
export function LicenceBarcodeScan({ onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [preview, setPreview] = useState<LicenceScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function stop() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function decodeBlob(blob: Blob): Promise<LicenceScan | null> {
    const { readBarcodes } = await import("zxing-wasm/reader");
    const result = await readBarcodes(blob, {
      formats: ["PDF417"],
      tryHarder: true,
      maxNumberOfSymbols: 1,
    });
    const text = result[0]?.text ?? "";
    return text ? parseAamvaLicence(text) : null;
  }

  async function openCamera() {
    setError(null);
    setBusy(true);
    try {
      await stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.playsInline = true;
      await video.play();
      const captured = await grabFrame(video);
      const scan = await decodeBlob(captured);
      if (!scan) {
        setError("The barcode did not read. Hold the licence steady, then take one photo.");
        return;
      }
      setPreview(scan);
      await stop();
    } catch {
      setError("Safari could not open the camera. Allow camera access and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const scan = await decodeBlob(file);
      if (!scan) {
        setError("That photo did not contain a readable licence barcode.");
        return;
      }
      setPreview(scan);
    } catch {
      setError("The barcode decoder could not run in this browser.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-[var(--border)] p-3">
      <p className="text-sm font-medium">Scan driver’s licence</p>
      <p className="mt-1 text-xs text-[var(--status-neutral)]">
        Point the rear camera at the barcode on the back. Confirm the fields before saving.
        The licence number stays on the private profile.
      </p>
      <video ref={videoRef} className="mt-2 hidden" muted playsInline />
      <div className="relative mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void openCamera()}>
          Open camera
        </button>
        <label htmlFor="licence-barcode-photo" className="btn btn-secondary">
          Use a photo
        </label>
        <input
          id="licence-barcode-photo"
          type="file"
          accept="image/*"
          capture="environment"
          className="photo-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";
            void onPhoto(file);
          }}
        />
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {preview ? (
        <div className="mt-3 text-sm">
          <p>
            {preview.firstName} {preview.lastName}
          </p>
          <p>{preview.address}</p>
          <p>Born {preview.dateOfBirth || "—"}</p>
          <p>Expires {preview.licenceExpiry || "—"}</p>
          <p>Licence {preview.licenceNumber}</p>
          <button
            type="button"
            className="btn mt-2"
            onClick={() => {
              onConfirm(preview);
              setPreview(null);
              void stop();
            }}
          >
            Use these details
          </button>
        </div>
      ) : null}
    </div>
  );
}

function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("CANVAS"));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PHOTO"));
    }, "image/jpeg", 0.92);
  });
}
