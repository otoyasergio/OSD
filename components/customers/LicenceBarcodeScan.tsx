"use client";

import { useEffect, useRef, useState } from "react";
import type { LicenceScan } from "@/lib/id/aamva";
import { readLicenceBarcode } from "@/lib/id/readLicenceBarcode";

type Props = {
  onConfirm: (scan: LicenceScan) => void;
};

const SCAN_BUDGET_MS = 12_000;
const SCAN_PAUSE_MS = 250;

/**
 * Reads the PDF417 on the back of an Ontario licence. The rear camera keeps
 * sampling until the barcode parses. A still photo is the fallback. The photo
 * bytes are copied before the file input is cleared — iOS Safari revokes a
 * library picture the moment that value is reset.
 */
export function LicenceBarcodeScan({ onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const cancelRef = useRef(false);
  const [preview, setPreview] = useState<LicenceScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.srcObject = null;
    video.hidden = true;
  }

  useEffect(() => {
    return () => {
      scanningRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  function stopScan() {
    cancelRef.current = true;
    scanningRef.current = false;
  }

  async function openCamera() {
    setError(null);
    setPreview(null);
    setBusy(true);
    cancelRef.current = false;
    try {
      stopTracks();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopTracks();
        return;
      }
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.hidden = false;
      setLive(true);
      await video.play();
      if (cancelRef.current) return;
      scanningRef.current = true;
      const scan = await scanFrames(video, () => scanningRef.current);
      if (cancelRef.current) return;
      if (!scan) {
        setError(
          "The barcode did not read. Hold the licence steady, then take one photo."
        );
        return;
      }
      setPreview(scan);
    } catch {
      setError("Safari could not open the camera. Allow camera access and try again.");
    } finally {
      scanningRef.current = false;
      setLive(false);
      setBusy(false);
      stopTracks();
    }
  }

  async function onPhoto(input: HTMLInputElement, file: File | null) {
    if (!file) return;
    stopScan();
    setBusy(true);
    setError(null);
    try {
      // Copy before clearing. iOS Safari makes the File unreadable after reset.
      const bytes = await file.arrayBuffer();
      input.value = "";
      const scan = await readLicenceBarcode(new Uint8Array(bytes));
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
        Point the rear camera at the barcode on the back. Confirm the fields before
        saving. The licence number stays on the private profile.
      </p>
      <video
        ref={videoRef}
        className="mt-2 max-h-64 w-full rounded bg-black object-cover"
        muted
        playsInline
        autoPlay
        hidden={!live}
      />
      <div className="relative mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void openCamera()}
        >
          {live ? "Scanning…" : "Open camera"}
        </button>
        {live ? (
          <button type="button" className="btn btn-secondary" onClick={stopScan}>
            Stop
          </button>
        ) : null}
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
            const input = event.currentTarget;
            const file = input.files?.[0] ?? null;
            void onPhoto(input, file);
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
              stopScan();
              stopTracks();
            }}
          >
            Use these details
          </button>
        </div>
      ) : null}
    </div>
  );
}

async function scanFrames(
  video: HTMLVideoElement,
  shouldContinue: () => boolean
): Promise<LicenceScan | null> {
  const deadline = Date.now() + SCAN_BUDGET_MS;
  while (shouldContinue() && Date.now() < deadline) {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      try {
        const frame = await grabFrame(video);
        const scan = await readLicenceBarcode(frame);
        if (scan || !shouldContinue()) return scan;
      } catch {
        // A blank frame while the camera warms up is not a failure.
      }
    }
    if (!shouldContinue()) return null;
    await delay(SCAN_PAUSE_MS);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return Promise.reject(new Error("FRAME"));
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return Promise.reject(new Error("CANVAS"));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PHOTO"));
      },
      "image/jpeg",
      0.92
    );
  });
}
