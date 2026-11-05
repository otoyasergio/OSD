"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { MessageSquareWarning } from "lucide-react";
import {
  submitStaffFeedbackAction,
  type StaffFeedbackFormState,
} from "@/app/(app)/feedback/actions";
import type { UserRole } from "@/lib/database/types";
import { canSubmitStaffFeedback } from "@/lib/permissions/checks";
import { captureStaffFeedbackScreenshot } from "@/lib/staffFeedback/captureViewport";

const INITIAL_STATE: StaffFeedbackFormState = { error: null, receipt: null };

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function StaffFeedbackComposer({
  screenshot,
  captureNote,
  pagePath,
  viewport,
  onSent,
  onClose,
}: {
  screenshot: Blob | null;
  captureNote: string | null;
  pagePath: string;
  viewport: { width: number; height: number };
  onSent: () => void;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: StaffFeedbackFormState, formData: FormData) => {
      const result = await submitStaffFeedbackAction(prev, formData);
      if (result.receipt) onSent();
      return result;
    },
    INITIAL_STATE
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewUrl = useMemo(
    () => (screenshot ? URL.createObjectURL(screenshot) : null),
    [screenshot]
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  return (
    <div
      className="staff-feedback-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-feedback-title"
        className="staff-feedback-dialog"
      >
        <form
          action={(formData) => {
            if (screenshot) {
              formData.set(
                "screenshot",
                new File([screenshot], "screen.jpg", {
                  type: screenshot.type || "image/jpeg",
                })
              );
            }
            formAction(formData);
          }}
        >
          <h2 id="staff-feedback-title" className="staff-feedback-title">
            What doesn&apos;t make sense?
          </h2>
          <p className="staff-feedback-help">
            The owner reads this in Logs. Open notes are packed into one archive each
            night at 11:00 p.m. Toronto time.
          </p>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local screenshot blob
            <img
              src={previewUrl}
              alt="This screen, captured for the note"
              className="staff-feedback-preview"
            />
          ) : (
            <p className="staff-feedback-help">{captureNote}</p>
          )}
          <input type="hidden" name="page_path" value={pagePath} />
          <input type="hidden" name="viewport_width" value={viewport.width || ""} />
          <input type="hidden" name="viewport_height" value={viewport.height || ""} />
          <label className="staff-feedback-label" htmlFor="staff-feedback-note">
            What&apos;s wrong
          </label>
          <textarea
            ref={textareaRef}
            id="staff-feedback-note"
            name="note"
            required
            maxLength={2000}
            rows={5}
            className="staff-feedback-input"
            placeholder="The labor total shows twice, and the save button is covered."
          />
          {state.error ? (
            <p className="staff-feedback-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <div className="staff-feedback-actions">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Sending…" : screenshot ? "Send note and picture" : "Send note"}
            </button>
            {screenshot ? (
              <button
                type="submit"
                className="btn btn-secondary"
                name="skip_picture"
                value="1"
                disabled={pending}
              >
                Send the note only
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StaffFeedbackControl({ raised }: { raised: boolean }) {
  const pathname = usePathname();
  const mounted = useIsClient();
  const [phase, setPhase] = useState<"idle" | "capturing" | "composing">("idle");
  const [screenshot, setScreenshot] = useState<Blob | null>(null);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const onSent = useCallback(() => {
    setNotice("Sent. The owner can read it in Logs.");
    setPhase("idle");
    setScreenshot(null);
  }, []);

  const onClose = useCallback(() => {
    setPhase("idle");
    setScreenshot(null);
  }, []);

  async function start() {
    if (phase !== "idle") return;
    setPhase("capturing");
    setCaptureNote(null);
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    const blob = await captureStaffFeedbackScreenshot();
    setSession((current) => current + 1);
    setScreenshot(blob);
    setCaptureNote(
      blob ? null : "The picture didn't come through. You can still send a note."
    );
    setPhase("composing");
  }

  if (!mounted) return null;

  return (
    <>
      {phase === "composing"
        ? createPortal(
            <div data-staff-feedback="">
              <StaffFeedbackComposer
                key={session}
                screenshot={screenshot}
                captureNote={captureNote}
                pagePath={pathname || "/"}
                viewport={viewport}
                onSent={onSent}
                onClose={onClose}
              />
            </div>,
            document.body
          )
        : createPortal(
            <div
              data-staff-feedback=""
              className={
                raised
                  ? "staff-feedback-root staff-feedback-root--raised"
                  : "staff-feedback-root"
              }
            >
              {phase === "idle" ? (
                <button
                  type="button"
                  className="staff-feedback-launcher"
                  onClick={() => void start()}
                >
                  <MessageSquareWarning size={18} aria-hidden />
                  <span>Something&apos;s off</span>
                </button>
              ) : null}
              {phase === "capturing" ? (
                <p role="status" className="staff-feedback-status">
                  Taking a picture of this screen…
                </p>
              ) : null}
              {notice && phase === "idle" ? (
                <p role="status" className="staff-feedback-notice">
                  {notice}
                </p>
              ) : null}
            </div>,
            document.body
          )}
    </>
  );
}

export function StaffFeedbackButton({
  role,
  raised = false,
}: {
  role: UserRole;
  raised?: boolean;
}) {
  if (!canSubmitStaffFeedback(role)) return null;
  return <StaffFeedbackControl raised={raised} />;
}
