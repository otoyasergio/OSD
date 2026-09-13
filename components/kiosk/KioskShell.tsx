"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KioskStaffRow,
  KioskStaffSessionState,
} from "@/lib/services/timeClockKiosk";
import {
  kioskClockInAction,
  kioskClockOutAction,
  kioskEndMealAction,
  kioskStartMealAction,
  verifyKioskPinAction,
} from "@/app/(kiosk)/kiosk/actions";
import { SignOutButton } from "@/components/layout/SignOutButton";

type Step = "list" | "pin" | "camera" | "success";

type Props = {
  staff: KioskStaffRow[];
};

function roleLabel(role: string) {
  if (role === "head_tech") return "Head tech";
  if (role === "service_advisor") return "Advisor";
  if (role === "technician") return "Technician";
  return role;
}

export function KioskShell({ staff }: Props) {
  const [step, setStep] = useState<Step>("list");
  const [selected, setSelected] = useState<KioskStaffRow | null>(null);
  const [pin, setPin] = useState("");
  const [clockState, setClockState] = useState<KioskStaffSessionState | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const resetToList = useCallback(() => {
    stopCamera();
    setStep("list");
    setSelected(null);
    setPin("");
    setClockState(null);
    setPhotoBase64(null);
    setError(null);
    setPending(false);
    setSuccessMessage("");
  }, [stopCamera]);

  useEffect(() => {
    if (step !== "camera") {
      stopCamera();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setError("Camera access is required. Allow camera permission and try again.");
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [step, stopCamera]);

  useEffect(() => {
    if (step !== "success") return;
    const ms = clockState?.supervisor_hours_warning ? 6000 : 2200;
    const t = setTimeout(() => resetToList(), ms);
    return () => clearTimeout(t);
  }, [step, resetToList, clockState?.supervisor_hours_warning]);

  function selectStaff(person: KioskStaffRow) {
    if (!person.has_pin) {
      setError("No PIN set for this person. Ask a manager to set a time clock PIN.");
      return;
    }
    setError(null);
    setSelected(person);
    setPin("");
    setStep("pin");
  }

  function appendDigit(digit: string) {
    setError(null);
    setPin((prev) => (prev.length >= 4 ? prev : `${prev}${digit}`));
  }

  function clearPin() {
    setPin("");
    setError(null);
  }

  async function submitPin() {
    if (!selected || pin.length !== 4 || pending) return;
    setPending(true);
    setError(null);
    const result = await verifyKioskPinAction(selected.user_id, pin);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      setPin("");
      return;
    }
    setClockState(result.state ?? null);
    setStep("camera");
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera is not ready yet.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Could not capture photo.");
      return;
    }
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPhotoBase64(dataUrl);
    setError(null);
  }

  async function runAction(action: "in" | "out" | "meal_start" | "meal_end") {
    if (!selected || !photoBase64 || pending) return;
    setPending(true);
    setError(null);
    const runner =
      action === "in"
        ? kioskClockInAction
        : action === "out"
          ? kioskClockOutAction
          : action === "meal_start"
            ? kioskStartMealAction
            : kioskEndMealAction;
    const result = await runner(selected.user_id, pin, photoBase64);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.state) setClockState(result.state);
    stopCamera();
    const label =
      action === "in"
        ? "Signed in"
        : action === "out"
          ? "Signed out"
          : action === "meal_start"
            ? "Meal started"
            : "Meal ended";
    setSuccessMessage(`${label} — ${selected.first_name} ${selected.last_name}`);
    setStep("success");
  }

  const onBreak = Boolean(clockState?.openBreak);
  const clockedIn = Boolean(clockState?.openEntry);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-6 sm:px-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-[var(--status-neutral)]">
            Toronto Moto
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Time clock
          </h1>
        </div>
        <SignOutButton />
      </header>

      {error ? (
        <p
          className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {step === "list" ? (
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {staff.length === 0 ? (
            <p className="col-span-full text-center text-[var(--status-neutral)]">
              No punchable staff at this location.
            </p>
          ) : (
            staff.map((person) => (
              <button
                key={person.user_id}
                type="button"
                onClick={() => selectStaff(person)}
                className="flex min-h-28 flex-col items-start justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-5 text-left shadow-sm transition hover:border-[var(--accent)] hover:shadow"
              >
                <span className="text-xl font-semibold text-foreground">
                  {person.first_name} {person.last_name}
                </span>
                <span className="mt-1 text-sm text-[var(--status-neutral)]">
                  {roleLabel(person.role)}
                  {!person.has_pin ? " · No PIN" : ""}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {step === "pin" && selected ? (
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6">
          <div className="text-center">
            <p className="text-sm text-[var(--status-neutral)]">Enter PIN for</p>
            <p className="text-2xl font-semibold text-foreground">
              {selected.first_name} {selected.last_name}
            </p>
          </div>
          <div className="flex gap-3" aria-label="PIN digits entered">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="flex size-14 items-center justify-center rounded-full border border-[var(--border-strong)] bg-white text-2xl"
              >
                {pin[i] ? "•" : ""}
              </span>
            ))}
          </div>
          <div className="grid w-full grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "ok"].map(
              (key) => (
                <button
                  key={key}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (key === "clear") clearPin();
                    else if (key === "ok") void submitPin();
                    else appendDigit(key);
                  }}
                  className="min-h-16 rounded-xl border border-[var(--border)] bg-white text-2xl font-semibold text-foreground hover:bg-[var(--surface-muted)] disabled:opacity-50"
                >
                  {key === "clear" ? "Clear" : key === "ok" ? "OK" : key}
                </button>
              )
            )}
          </div>
          <button
            type="button"
            className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
            onClick={resetToList}
          >
            Back to staff list
          </button>
        </div>
      ) : null}

      {step === "camera" && selected ? (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5">
          <div className="text-center">
            <p className="text-2xl font-semibold text-foreground">
              {selected.first_name} {selected.last_name}
            </p>
            <p className="text-sm text-[var(--status-neutral)]">
              {clockedIn ? (onBreak ? "On meal break" : "Signed in") : "Signed out"}
              {clockState != null ? ` · ${clockState.week_paid_hours}h this week` : ""}
            </p>
          </div>
          {clockState?.supervisor_hours_warning && clockState.supervisor_hours_message ? (
            <div
              className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-center text-base font-medium text-amber-950"
              role="status"
            >
              {clockState.supervisor_hours_message}
            </div>
          ) : null}
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[4/3] w-full object-cover"
            />
            {photoBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoBase64}
                alt="Captured punch photo"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              className="btn btn-secondary min-h-12 px-5"
              onClick={() => {
                setPhotoBase64(null);
                capturePhoto();
              }}
              disabled={pending}
            >
              {photoBase64 ? "Retake photo" : "Take photo"}
            </button>
          </div>
          {photoBase64 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {!clockedIn ? (
                <button
                  type="button"
                  className="btn btn-primary min-h-14 text-lg"
                  disabled={pending}
                  onClick={() => void runAction("in")}
                >
                  Sign in
                </button>
              ) : null}
              {clockedIn && !onBreak ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary min-h-14 text-lg"
                    disabled={pending}
                    onClick={() => void runAction("out")}
                  >
                    Sign out
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary min-h-14 text-lg"
                    disabled={pending}
                    onClick={() => void runAction("meal_start")}
                  >
                    Start meal
                  </button>
                </>
              ) : null}
              {clockedIn && onBreak ? (
                <button
                  type="button"
                  className="btn btn-primary min-h-14 text-lg"
                  disabled={pending}
                  onClick={() => void runAction("meal_end")}
                >
                  End meal
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-center text-sm text-[var(--status-neutral)]">
              Take a photo, then choose an action.
            </p>
          )}
          <button
            type="button"
            className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
            onClick={resetToList}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {step === "success" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-4xl font-semibold text-foreground">{successMessage}</p>
          {clockState?.supervisor_hours_warning && clockState.supervisor_hours_message ? (
            <div
              className="max-w-lg rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-lg font-medium text-amber-950"
              role="status"
            >
              {clockState.supervisor_hours_message}
            </div>
          ) : null}
          <p className="text-[var(--status-neutral)]">Returning to staff list…</p>
        </div>
      ) : null}
    </div>
  );
}
