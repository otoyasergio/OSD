"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { extractVinFromScanText } from "@/lib/vin/extractFromScan";

type Props = {
  onClose: () => void;
  /** Called with a validated 17-character VIN. */
  onScanned: (vin: string) => void;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorCtor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

const VIN_OCR_WHITELIST = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (
    window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
  ).BarcodeDetector;
  return ctor ?? null;
}

async function detectNativeBarcode(
  video: HTMLVideoElement
): Promise<string | null> {
  const Detector = getBarcodeDetector();
  if (!Detector) return null;
  try {
    const detector = new Detector({
      formats: ["code_39", "code_128", "qr_code", "pdf417", "data_matrix"],
    });
    const codes = await detector.detect(video);
    for (const code of codes) {
      if (code.rawValue?.trim()) return code.rawValue.trim();
    }
  } catch {
    // Native detector unavailable or frame not ready — fall through.
  }
  return null;
}

function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return canvas;
}

/**
 * Full-screen rear-camera VIN scanner. Mount only while open so each open
 * gets a fresh camera session (parent: `{open ? <VinScanner … /> : null}`).
 */
export function VinScanner({ onClose, onScanned }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const handledRef = useRef(false);
  const [status, setStatus] = useState("Starting camera…");
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [candidates, setCandidates] = useState<string[] | null>(null);

  const stopCamera = useCallback(() => {
    zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const finishWithText = useCallback(
    (raw: string) => {
      if (handledRef.current) return;
      const result = extractVinFromScanText(raw);
      if (!result.ok) {
        setError(result.error);
        setStatus("No valid VIN in that scan — try again or type it.");
        return;
      }
      if (result.ambiguous) {
        setCandidates(result.candidates);
        setStatus("Multiple VINs found — pick the correct one.");
        setError(null);
        return;
      }
      handledRef.current = true;
      stopCamera();
      onScanned(result.vin);
      onClose();
    },
    [onClose, onScanned, stopCamera]
  );

  const pickCandidate = useCallback(
    (vin: string) => {
      handledRef.current = true;
      stopCamera();
      onScanned(vin);
      onClose();
    },
    [onClose, onScanned, stopCamera]
  );

  useEffect(() => {
    let cancelled = false;
    let barcodeTimer: number | null = null;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Camera is not available in this browser. Type the VIN instead."
        );
        setStatus("Camera unavailable");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setCameraReady(true);
        setStatus("Line up the VIN sticker or stamped number");

        const hasNative = Boolean(getBarcodeDetector());
        if (hasNative) {
          const tick = async () => {
            if (cancelled || handledRef.current) return;
            const videoEl = videoRef.current;
            if (videoEl && videoEl.readyState >= 2) {
              const raw = await detectNativeBarcode(videoEl);
              if (raw) finishWithText(raw);
            }
            if (!cancelled && !handledRef.current) {
              barcodeTimer = window.setTimeout(tick, 350);
            }
          };
          barcodeTimer = window.setTimeout(tick, 400);
        } else {
          try {
            const { BrowserMultiFormatReader, BarcodeFormat } = await import(
              "@zxing/browser"
            );
            if (cancelled || handledRef.current) return;
            const reader = new BrowserMultiFormatReader();
            reader.possibleFormats = [
              BarcodeFormat.CODE_39,
              BarcodeFormat.CODE_128,
              BarcodeFormat.QR_CODE,
              BarcodeFormat.PDF_417,
              BarcodeFormat.DATA_MATRIX,
            ];
            const controls = await reader.decodeFromStream(
              stream,
              video,
              (result, err) => {
                if (cancelled || handledRef.current) return;
                if (result) {
                  finishWithText(result.getText());
                  return;
                }
                void err;
              }
            );
            zxingControlsRef.current = controls;
          } catch {
            setStatus(
              "Barcode reader unavailable — use “Use this frame” for OCR."
            );
          }
        }
      } catch {
        setCameraReady(false);
        setError(
          "Camera permission denied. Allow camera access, or type the VIN."
        );
        setStatus("Camera blocked");
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (barcodeTimer != null) window.clearTimeout(barcodeTimer);
      stopCamera();
    };
  }, [finishWithText, stopCamera]);

  async function runOcr() {
    const video = videoRef.current;
    if (!video || ocrBusy || handledRef.current) return;
    const canvas = captureVideoFrame(video);
    if (!canvas) {
      setError("Camera frame not ready yet. Wait a moment and try again.");
      return;
    }

    setOcrBusy(true);
    setError(null);
    setStatus("Reading stamped VIN…");
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      try {
        await worker.setParameters({
          tessedit_char_whitelist: VIN_OCR_WHITELIST,
        });
        const {
          data: { text },
        } = await worker.recognize(canvas);
        finishWithText(text);
      } finally {
        await worker.terminate();
      }
    } catch {
      setError("OCR failed. Try again or type the VIN.");
      setStatus("Line up the VIN sticker or stamped number");
    } finally {
      setOcrBusy(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Scan VIN"
    >
      <div className="relative min-h-0 flex-1 bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          autoPlay
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="h-28 w-full max-w-md rounded-md border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        <p className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))] text-center text-sm font-medium">
          {status}
        </p>
      </div>

      <div className="space-y-3 bg-black px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {error ? (
          <p className="text-center text-sm text-amber-200" role="alert">
            {error}
          </p>
        ) : null}

        {candidates ? (
          <div className="space-y-2">
            <p className="text-center text-sm text-white/80">
              Tap the correct VIN
            </p>
            {candidates.map((vin) => (
              <button
                key={vin}
                type="button"
                className="btn min-h-11 w-full border border-white/30 bg-white/10 font-mono text-base tracking-wide text-white"
                onClick={() => pickCandidate(vin)}
              >
                {vin}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="btn btn-primary min-h-12 flex-1 text-base"
            disabled={ocrBusy || !cameraReady}
            onClick={() => void runOcr()}
          >
            {ocrBusy ? "Reading…" : "Use this frame"}
          </button>
          <button
            type="button"
            className="btn min-h-12 flex-1 border border-white/40 bg-transparent text-base text-white"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
