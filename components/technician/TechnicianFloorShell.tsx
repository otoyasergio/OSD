"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  forwardRef,
  useActionState,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useDebouncedRouterRefresh } from "@/lib/client/useDebouncedRouterRefresh";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import type { FloorOsSurface, TechnicianFloorOs } from "@/lib/services/technicianFloor";
import type { DocketItem } from "@/lib/services/technicianDocket";
import type { ReadyForPickupItem } from "@/lib/services/readyForPickup";
import { TechnicianDocketList } from "@/components/technician/TechnicianDocketList";
import { ReadyForPickupCarousel } from "@/components/technician/ReadyForPickupCarousel";
import {
  acknowledgeDocketJobAction,
  completeJobFloorAction,
  completePerformWorkAction,
  failPeerQcAction,
  installPartFloorAction,
  parkJobAction,
  passPeerQcAction,
  pullOntoBenchAction,
  resumeParkedJobAction,
  savePerformWorkNoteAction,
  skipProofAction,
  swapBenchJobAction,
  toggleChecklistAction,
  uploadJobProofAction,
  type FloorActionState,
} from "@/app/(app)/technician/floor-actions";
import {
  failSafetyCheckAction,
  passSafetyCheckAction,
} from "@/app/(app)/work_orders/safety-actions";
import {
  techJobPacketHref,
  type JobPacketSection,
} from "@/lib/technician/assignmentHref";
import type { JobPacket } from "@/lib/services/jobPacket";
import type { IntakePhoto } from "@/lib/services/photos";
import { JobPacketPanel } from "@/components/technician/JobPacketPanel";
import { deriveDefaultStage, type FloorStage } from "@/lib/technician/floorStage";
import { formatDateTime } from "@/lib/datetime/format";
import {
  PARK_REASON_OPTIONS,
  PROOF_SKIP_OPTIONS,
  QC_JUDGEMENT_LABELS,
  isFloorJobFinished,
  isPitBoardStepActionableWhileParked,
  isPitBoardStepTappable,
  type PitBoardStep,
} from "@/lib/technician/pitBoard";
import { buildFloorCompletionSummary } from "@/lib/technician/floorCompletionSummary";

export type { FloorStage };
export { deriveDefaultStage };

function closePacketHref(workOrderId: string, jobId: string | null | undefined): string {
  const params = new URLSearchParams();
  params.set("wo", workOrderId);
  if (jobId) params.set("job", jobId);
  return `/technician?${params.toString()}`;
}

function formatTimer(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function ActionMessage({ state }: { state: FloorActionState }) {
  if (!state?.error && !state?.success) return null;
  return (
    <p
      className={`floor-dock-msg ${state.error ? "floor-dock-msg--error" : "floor-dock-msg--ok"}`}
      role="status"
    >
      {state.error ?? state.success}
    </p>
  );
}

function JobPacketErrorState({ backHref }: { backHref: string }) {
  return (
    <div className="floor-surface-empty floor-packet-error">
      <h2 className="floor-section-title">Couldn&apos;t open notes &amp; photos</h2>
      <p className="floor-muted">
        This work order may be unavailable or you may not have access.
      </p>
      <Link href={backHref} className="btn btn-secondary floor-tap floor-tap--wide">
        Back to jobs
      </Link>
    </div>
  );
}

function Plate({
  kicker,
  title,
  body,
  pipe,
}: {
  kicker: string;
  title: string;
  body: string;
  pipe?: string[];
}) {
  return (
    <div className="pit-plate">
      <p className="pit-plate-kicker">{kicker}</p>
      <p className="pit-plate-title">{title}</p>
      <p className="pit-plate-body">{body}</p>
      {pipe && pipe.length > 0 ? (
        <div className="pit-pipe" aria-label="Pipeline">
          {pipe.map((step, i) => (
            <span key={step} className="pit-pipe-step">
              {i > 0 ? <span className="pit-pipe-arrow">→</span> : null}
              <span className="pit-pipe-chip">{step}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CompletionSummary({ surface }: { surface: FloorOsSurface }) {
  const summary = buildFloorCompletionSummary(surface);
  if (!summary) return null;

  const hasCompletedLines =
    summary.service_names.length > 0 ||
    summary.inspection_complete ||
    summary.checklist_done.length > 0 ||
    summary.parts_installed_count > 0;
  const hasPending = summary.pending_recommendations.length > 0;
  if (!hasCompletedLines && !hasPending) return null;

  return (
    <div className="pit-completion" aria-label="Job completion summary">
      {hasCompletedLines ? (
        <>
          <p className="pit-completion-kicker">WHAT YOU FINISHED</p>
          <ul className="pit-completion-list">
            {summary.service_names.map((name, index) => (
              <li key={`${name}-${index}`}>{name}</li>
            ))}
            {summary.inspection_complete ? <li>Inspection complete</li> : null}
            {summary.checklist_done.map((title) => (
              <li key={title}>{title}</li>
            ))}
            {summary.parts_installed_count > 0 ? (
              <li>
                {summary.parts_installed_count} part
                {summary.parts_installed_count === 1 ? "" : "s"} installed
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
      {summary.pending_recommendations.length > 0 ? (
        <div
          className={[
            "pit-completion-pending",
            !hasCompletedLines ? "pit-completion-pending--solo" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <p className="pit-completion-pending-kicker">STILL PENDING — CLIENT DECISION</p>
          <ul className="pit-completion-pending-list">
            {summary.pending_recommendations.map((rec) => (
              <li key={rec.recommendation_id}>{rec.description}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function plateFor(s: FloorOsSurface) {
  if (s.board_status === "offered") {
    return {
      kicker: "ASSIGNED BY FRONT DESK",
      title: `${s.service_name ?? "Job"} — ready when you are`,
      body: "It’s in your line. Tap Got it, then pull it onto the bench when you’re ready — that’s when your clock starts.",
    };
  }
  if (s.job_status === "waiting_for_approval") {
    return {
      kicker: "WAITING FOR CLIENT APPROVAL",
      title: "Front desk owns this wait",
      body: "This job itself still needs a client yes. Once approved, it lands back in your line under Perform work.",
    };
  }
  if (s.board_status === "waiting") {
    return {
      kicker: `PARKED — ${s.park_reason_label.toUpperCase()}`,
      title: "Clock paused — review anytime",
      body: `${s.wait_owner_label}. Resume when you're ready to wrench. You can still mark Perform work done, check off verify and cleanup steps, save notes, and review details below — no clock restart needed for checklist.`,
    };
  }
  if (s.board_status === "next") {
    return {
      kicker: "IN YOUR LINE — NOT STARTED",
      title: "Ready when you are",
      body: "Pull it onto the bench to start the clock. Anything already on the bench parks itself with the spot saved.",
    };
  }
  if (s.board_status === "done") {
    return {
      kicker: "COMPLETE",
      title: "Your wrench work is done ✓",
      body: "Here’s the rest of its trip — none of it is yours unless it bounces back.",
      pipe: ["WRENCH", "PEER QC", "SAFETY", "PICKUP"],
    };
  }
  if (s.is_safety) {
    return {
      kicker: "HEAD-TECH SAFETY",
      title: s.can_safety ? "Final safety call" : "Waiting on head tech",
      body: s.can_safety
        ? "Pass or fail below. Front desk books pickup after pass."
        : "You’re done unless this bike is assigned to you for safety.",
      pipe: ["WRENCH", "PEER QC", "SAFETY", "PICKUP"],
    };
  }
  if (s.board_status === "check" || s.is_qc) {
    return null;
  }
  return null;
}

function SurfacePlate({ surface }: { surface: FloorOsSurface }) {
  const plate = plateFor(surface);
  const finished = isFloorJobFinished({
    board_status: surface.board_status,
    job_status: surface.job_status,
    completed_at: surface.completed_at,
  });
  if (!finished && !plate) return null;
  return (
    <>
      {finished ? <CompletionSummary surface={surface} /> : null}
      {plate ? (
        <Plate
          kicker={plate.kicker}
          title={plate.title}
          body={plate.body}
          pipe={plate.pipe}
        />
      ) : null}
    </>
  );
}

export type PitPhotoFieldHandle = {
  openCamera: () => void;
  openLibrary: () => void;
};

const PitPhotoField = forwardRef<
  PitPhotoFieldHandle,
  {
    hint: string;
    variant?: "default" | "dock";
    onPhotoReady?: (label: string | null) => void;
  }
>(function PitPhotoField({ hint, variant = "default", onPhotoReady }, ref) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoLabel, setPhotoLabel] = useState<string | null>(null);
  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");

  useImperativeHandle(ref, () => ({
    openCamera: () => cameraInputRef.current?.click(),
    openLibrary: () => libraryInputRef.current?.click(),
  }));

  function notifyPhotoReady(label: string | null) {
    setPhotoLabel(label);
    onPhotoReady?.(label);
  }

  function applyPickedFile(input: HTMLInputElement) {
    const file = input.files?.[0] ?? null;
    const target = fileInputRef.current;
    if (!target) return;
    if (!file) {
      target.value = "";
      notifyPhotoReady(null);
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    target.files = transfer.files;
    notifyPhotoReady(file.name);
    input.value = "";
  }

  const dock = variant === "dock";

  return (
    <div
      className={["pit-photo-field", dock ? "pit-photo-field--dock" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        ref={fileInputRef}
        type="file"
        name="file"
        accept={libraryProps.accept}
        className="photo-file-input"
        tabIndex={-1}
        aria-label="Selected photo"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          notifyPhotoReady(file?.name ?? null);
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept={cameraProps.accept}
        capture={cameraProps.capture}
        className="photo-file-input"
        tabIndex={-1}
        aria-label="Add photo"
        onChange={(event) => applyPickedFile(event.currentTarget)}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept={libraryProps.accept}
        className="photo-file-input"
        tabIndex={-1}
        aria-label="Choose from library"
        onChange={(event) => applyPickedFile(event.currentTarget)}
      />
      {dock ? null : (
        <>
          <div className="pit-photo-actions">
            <button
              type="button"
              className="pit-photo-add"
              onClick={() => cameraInputRef.current?.click()}
            >
              Add photo
            </button>
            <button
              type="button"
              className="pit-photo-library"
              onClick={() => libraryInputRef.current?.click()}
            >
              Choose from library
            </button>
          </div>
          {photoLabel ? (
            <p className="pit-photo-ready" role="status">
              Photo ready — {photoLabel}
            </p>
          ) : (
            <p className="pit-photo-hint">{hint}</p>
          )}
        </>
      )}
    </div>
  );
});

function PitDockIcon({ children, label }: { children: ReactNode; label: string }) {
  return (
    <>
      <span className="pit-work-dock-icon" aria-hidden>
        {children}
      </span>
      <span className="pit-work-dock-label">{label}</span>
    </>
  );
}

const WORK_NOTES_PREVIEW = 1;

type PerformWorkPanel = "work" | "parts" | "notes";

function StepRow({
  step,
  active,
  onToggle,
}: {
  step: PitBoardStep;
  active: boolean;
  onToggle?: () => void;
}) {
  const done = step.state === "done" || step.state === "skipped";
  const viewable = Boolean(onToggle);
  return (
    <button
      type="button"
      className={[
        "pit-step",
        active ? "pit-step--active" : "",
        done ? "pit-step--done" : "",
        viewable ? "pit-step--viewable" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
      disabled={!onToggle}
      aria-label={
        viewable && step.kind === "inspect"
          ? `${step.label} — view completed report`
          : undefined
      }
    >
      <span className="pit-step-box" aria-hidden>
        {step.state === "skipped" ? "→" : done ? "✓" : ""}
      </span>
      <span className="pit-step-main">
        <span className="pit-step-label">{step.label}</span>
        {step.sub ? <span className="pit-step-sub">{step.sub}</span> : null}
      </span>
      {step.tag ? <span className="pit-step-tag">{step.tag}</span> : null}
    </button>
  );
}

type Overlay = null | "park" | "fail" | "swap" | "proof" | "work" | "qc_pick";

export function TechnicianFloorShell({
  floor,
  stage: _stage,
  docketItems,
  readyForPickup,
  panel,
  packet,
  packetSection,
  packetPhotos,
  packetWorkOrderId,
  packetJobId,
}: {
  floor: TechnicianFloorOs;
  stage?: FloorStage;
  docketItems: DocketItem[];
  readyForPickup: ReadyForPickupItem[];
  panel?: "packet" | null;
  packet?: JobPacket | null;
  packetSection?: JobPacketSection | null;
  packetPhotos?: IntakePhoto[];
  packetWorkOrderId?: string | null;
  packetJobId?: string | null;
}) {
  const router = useRouter();
  const surface = floor.selected;
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [qcChecks, setQcChecks] = useState<boolean[]>([false, false, false]);
  const [note, setNote] = useState<string | null>(null);
  const [workPanel, setWorkPanel] = useState<PerformWorkPanel>("work");
  const [workNoteDraft, setWorkNoteDraft] = useState("");
  const [workNoteSaved, setWorkNoteSaved] = useState<string | null>(null);
  const [workPartMessage, setWorkPartMessage] = useState<string | null>(null);
  const [workPhotoLabel, setWorkPhotoLabel] = useState<string | null>(null);
  const workPhotoRef = useRef<PitPhotoFieldHandle>(null);
  const workNoteInputRef = useRef<HTMLTextAreaElement>(null);
  const [timerSecs, setTimerSecs] = useState(surface?.timer_secs ?? 0);
  const [, startTransition] = useTransition();
  const overlayRef = useRef(overlay);
  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);
  const { schedule: scheduleRefresh, flush: flushRefresh } = useDebouncedRouterRefresh({
    delayMs: 800,
    isPaused: () => overlayRef.current !== null,
  });

  const [ackState, ackAction, ackPending] = useActionState(
    acknowledgeDocketJobAction,
    null
  );
  const [pullState, pullAction, pullPending] = useActionState(pullOntoBenchAction, null);
  const [parkState, parkAction, parkPending] = useActionState(parkJobAction, null);
  const [resumeState, resumeAction, resumePending] = useActionState(
    resumeParkedJobAction,
    null
  );
  const [swapState, swapAction, swapPending] = useActionState(swapBenchJobAction, null);
  const [completeState, completeAction, completePending] = useActionState(
    completeJobFloorAction,
    null
  );
  const [toggleState, toggleAction] = useActionState(toggleChecklistAction, null);
  const [installState, installAction, installPending] = useActionState(
    installPartFloorAction,
    null
  );
  const [proofState, proofAction, proofPending] = useActionState(
    uploadJobProofAction,
    null
  );
  const [skipState, skipAction, skipPending] = useActionState(skipProofAction, null);
  const [workState, workAction, workPending] = useActionState(
    completePerformWorkAction,
    null
  );
  const [workNoteState, workNoteAction, workNotePending] = useActionState(
    savePerformWorkNoteAction,
    null
  );
  const [passQcState, passQcAction, passQcPending] = useActionState(
    passPeerQcAction,
    null
  );
  const [failQcState, failQcAction, failQcPending] = useActionState(
    failPeerQcAction,
    null
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync timer from server surface
    setTimerSecs(surface?.timer_secs ?? 0);
  }, [surface?.job_id, surface?.timer_secs]);

  useEffect(() => {
    if (!surface?.job_timer_running || surface.board_status !== "bench") return;
    const id = window.setInterval(() => setTimerSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [surface?.job_timer_running, surface?.board_status, surface?.job_id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset work UI when job/overlay changes
    setWorkNoteDraft("");
    setWorkNoteSaved(null);
    setWorkPanel("work");
    setWorkPartMessage(null);
    setWorkPhotoLabel(null);
  }, [surface?.job_id, overlay]);

  useEffect(() => {
    if (overlay !== "work" || workPanel !== "parts") return;
    if (installState?.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect install action result
      setWorkPartMessage(installState.success);
      startTransition(() => scheduleRefresh());
    } else if (installState?.error) {
      setWorkPartMessage(installState.error);
    }
  }, [installState, overlay, workPanel, scheduleRefresh]);

  useEffect(() => {
    if (overlay !== "work" || workPanel !== "parts") return;
    if (parkState?.error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- surface park action error in parts panel
      setWorkPartMessage(parkState.error);
    }
  }, [parkState, overlay, workPanel]);

  useEffect(() => {
    if (workNoteState?.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear draft after successful note save
      setWorkNoteDraft("");
      setWorkNoteSaved(workNoteState.success);
      startTransition(() => scheduleRefresh());
    }
  }, [workNoteState, scheduleRefresh]);

  useEffect(() => {
    const states = [
      ackState,
      pullState,
      parkState,
      resumeState,
      swapState,
      completeState,
      skipState,
      workState,
      passQcState,
      failQcState,
    ];
    for (const s of states) {
      if (s?.success) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- close overlays after floor actions succeed
        setNote(s.success);
        setOverlay(null);
        startTransition(() => scheduleRefresh());
        break;
      }
      if (s?.error) {
        setNote(s.error);
        break;
      }
    }
  }, [
    ackState,
    pullState,
    parkState,
    resumeState,
    swapState,
    completeState,
    skipState,
    workState,
    passQcState,
    failQcState,
    scheduleRefresh,
  ]);

  useEffect(() => {
    if (overlay === null) {
      flushRefresh();
    }
  }, [overlay, flushRefresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [scheduleRefresh]);

  const selectedKey = useMemo(() => {
    if (!surface) return null;
    if (surface.is_qc) return `qc-${surface.work_order_id}`;
    if (surface.is_safety) return `safety-${surface.work_order_id}`;
    return `work-order-${surface.work_order_id}`;
  }, [surface]);

  const waitingItems = docketItems.filter(
    (item) => item.board_status === "waiting" || item.board_stamp === "HOLD"
  );
  const swapTargets = docketItems.filter(
    (item) =>
      item.job_id &&
      item.job_id !== surface?.job_id &&
      (item.board_status === "next" ||
        item.board_status === "waiting" ||
        item.board_status === "offered")
  );

  const go = surface?.go;
  const onBench = surface?.board_status === "bench";
  const parked = surface?.board_status === "waiting";
  const openPerformWorkStep = surface?.steps.find(
    (step) => step.kind === "work" && step.state === "open"
  );
  const openPerformWorkItemId = openPerformWorkStep?.target_id ?? "";
  const showWorkSurface =
    surface &&
    (surface.board_status === "bench" || (surface.is_qc && surface.qc_assignee_is_me));
  const showParkedSteps =
    Boolean(surface?.job_id) &&
    parked &&
    !surface?.is_qc &&
    !surface?.is_safety &&
    (surface?.steps.length ?? 0) > 0;

  const qcAllDone = qcChecks.every(Boolean);
  const goEnabled =
    go?.action === "pass_qc" ? qcAllDone && !passQcPending : Boolean(go?.enabled);

  // Park actions manage their own disabled state — don't lock the whole floor.
  const pending =
    ackPending ||
    pullPending ||
    resumePending ||
    swapPending ||
    completePending ||
    proofPending ||
    skipPending ||
    workPending ||
    workNotePending ||
    passQcPending ||
    failQcPending;

  function dispatchFloorAction(
    action: (payload: FormData) => void,
    fields: Record<string, string>
  ) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      fd.set(key, value);
    }
    startTransition(() => {
      action(fd);
    });
  }

  function runGo() {
    if (!surface || !go) return;
    if (go.action === "acknowledge" && surface.job_id) {
      dispatchFloorAction(ackAction, {
        job_id: surface.job_id,
        work_order_id: surface.work_order_id,
      });
      return;
    }
    if (go.action === "pull_onto_bench" && surface.job_id) {
      dispatchFloorAction(pullAction, {
        job_id: surface.job_id,
        work_order_id: surface.work_order_id,
      });
      return;
    }
    if (go.action === "resume" && surface.job_id) {
      dispatchFloorAction(resumeAction, {
        job_id: surface.job_id,
        work_order_id: surface.work_order_id,
      });
      return;
    }
    if (go.action === "complete" && surface.job_id) {
      setOverlay("qc_pick");
      return;
    }
    if (go.action === "pass_qc") {
      dispatchFloorAction(passQcAction, {
        work_order_id: surface.work_order_id,
      });
      return;
    }
    if (go.action === "advance_step" && go.step) {
      advanceStep(go.step);
    }
  }

  function advanceStep(step: PitBoardStep) {
    if (!surface) return;
    if (step.kind === "inspect") {
      router.push(surface.inspection_href);
      return;
    }
    if (step.kind === "work") {
      setOverlay("work");
      return;
    }
    if (step.kind === "checklist" && step.target_id) {
      const fd = new FormData();
      fd.set("item_id", step.target_id);
      fd.set("checked", "true");
      fd.set("work_order_id", surface.work_order_id);
      setNote(`Done: ${step.label}`);
      startTransition(() => {
        toggleAction(fd);
        scheduleRefresh();
      });
      return;
    }
    if (step.kind === "part" && step.target_id) {
      const fd = new FormData();
      fd.set("part_id", step.target_id);
      fd.set("work_order_id", surface.work_order_id);
      installAction(fd);
      setNote(`Done: ${step.label}`);
      startTransition(() => scheduleRefresh());
      return;
    }
    if (step.kind === "proof") {
      setOverlay("proof");
      return;
    }
    if (step.kind === "complete" && surface.job_id) {
      setOverlay("qc_pick");
    }
  }

  function completeWithQcAssignee(assigneeId: string | null) {
    if (!surface?.job_id) return;
    const fields: Record<string, string> = {
      job_id: surface.job_id,
      work_order_id: surface.work_order_id,
    };
    if (assigneeId) fields.qc_assignee_id = assigneeId;
    dispatchFloorAction(completeAction, fields);
  }

  function viewParkedStep(step: PitBoardStep) {
    if (!surface) return;
    if (step.kind === "inspect") {
      router.push(surface.inspection_href);
      return;
    }
    if (step.kind === "work") {
      setOverlay("work");
    }
  }

  function stepToggleHandler(step: PitBoardStep): (() => void) | undefined {
    if (!surface) return undefined;
    if (parked) {
      if (!isPitBoardStepActionableWhileParked(step)) return undefined;
      if (step.kind === "checklist" && step.state === "open") {
        return () => advanceStep(step);
      }
      return () => viewParkedStep(step);
    }
    if (isPitBoardStepTappable(step)) {
      return () => advanceStep(step);
    }
    return undefined;
  }

  const showPacket = panel === "packet";

  return (
    <div className="pit-shell">
      <header className="pit-topbar">
        <p className="pit-wordmark">OTOMOTO · TECH FLOOR</p>
        {readyForPickup.length > 0 ? (
          <div className="pit-pickup-strip">
            <ReadyForPickupCarousel items={readyForPickup} />
          </div>
        ) : null}
      </header>

      <div className="pit-layout">
        <aside className="pit-rail">
          <h2 className="pit-rail-title">Your line</h2>
          <TechnicianDocketList items={docketItems} selectedKey={selectedKey} />
          {waitingItems.length > 0 ? (
            <section className="pit-wait-panel" aria-label="Who owns the wait">
              <h3 className="pit-rail-title">Who owns the wait</h3>
              <ul className="pit-wait-list">
                {waitingItems.map((item) => (
                  <li key={item.key} className="pit-wait-row">
                    <p className="pit-wait-title">
                      {item.park_reason_label || "Waiting"} — {item.motorcycle_label}
                    </p>
                    <p className="pit-wait-sub">
                      {item.wait_owner_label || "Front desk"}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>

        <section className="pit-surface">
          {showPacket && packetWorkOrderId ? (
            packet ? (
              <JobPacketPanel
                packet={packet}
                section={packetSection ?? "notes"}
                photos={packetPhotos ?? []}
                selectedJobId={packetJobId ?? null}
                closeHref={closePacketHref(packetWorkOrderId, packetJobId)}
                stage="done"
              />
            ) : (
              <JobPacketErrorState
                backHref={closePacketHref(packetWorkOrderId, packetJobId)}
              />
            )
          ) : !surface ? (
            <div className="floor-surface-empty">
              <h2 className="floor-section-title">Pick a bike</h2>
              <p className="floor-muted">
                Your docket is on the left. Tap a bike to see the next move.
              </p>
            </div>
          ) : (
            <>
              <div className="pit-surface-header">
                <div className="pit-surface-heading">
                  <Link
                    href={techJobPacketHref(surface.work_order_id, {
                      jobId: surface.job_id ?? undefined,
                      section: "notes",
                    })}
                    className="pit-surface-heading-link"
                    title="Open notes & intake photos"
                  >
                    <h2 className="pit-bike-title">{surface.motorcycle_label}</h2>
                    <p className="pit-meta">
                      <span className="pit-wo-chip">{surface.work_order_number}</span>
                      {surface.service_name ? (
                        <>
                          <span aria-hidden> · </span>
                          {surface.service_name}
                        </>
                      ) : null}
                    </p>
                  </Link>
                  <div className="pit-header-access" aria-label="Notes and intake photos">
                    <Link
                      href={techJobPacketHref(surface.work_order_id, {
                        jobId: surface.job_id ?? undefined,
                        section: "notes",
                      })}
                      className="pit-header-access-link"
                    >
                      Notes
                    </Link>
                    <Link
                      href={techJobPacketHref(surface.work_order_id, {
                        jobId: surface.job_id ?? undefined,
                        section: "photos",
                      })}
                      className="pit-header-access-link"
                    >
                      Photos
                    </Link>
                  </div>
                </div>
                {(onBench || surface.board_status === "waiting") && surface.job_id ? (
                  <span className="pit-timer" aria-live="polite">
                    {formatTimer(timerSecs)}
                  </span>
                ) : null}
              </div>

              {note ? (
                <p
                  className={[
                    "pit-note",
                    /cannot|failed|error|clock in|forbidden|not /i.test(note)
                      ? "pit-note--error"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  role="status"
                >
                  {note}
                </p>
              ) : null}

              {surface.pending_recommendations.length > 0 &&
              surface.job_status !== "waiting_for_approval" &&
              !isFloorJobFinished({
                board_status: surface.board_status,
                job_status: surface.job_status,
                completed_at: surface.completed_at,
              }) ? (
                <p className="pit-note" role="status">
                  {surface.pending_recommendations.length} recommendation
                  {surface.pending_recommendations.length === 1 ? "" : "s"} on hold for
                  the client (approve later → new docket job; decline → stay finished).
                  You can complete this job now.
                </p>
              ) : null}

              {surface.jobs.filter((j) => j.assigned_to_me).length > 1 ? (
                <div className="pit-job-switch" aria-label="Services on this bike">
                  {surface.jobs
                    .filter((j) => j.assigned_to_me)
                    .map((job) => (
                      <Link
                        key={job.job_id}
                        href={`/technician?job=${job.job_id}&wo=${surface.work_order_id}`}
                        className={[
                          "pit-job-chip",
                          job.is_selected ? "pit-job-chip--active" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {job.service_name}
                        <span className="pit-job-chip-status">{job.status_label}</span>
                      </Link>
                    ))}
                </div>
              ) : null}

              <div className="pit-surface-body">
                {surface.is_qc && surface.qc_assignee_is_me ? (
                  <div className="pit-qc">
                    <p className="pit-plate-kicker">PEER QC — VOUCH FOR THIS BIKE</p>
                    <ul className="pit-qc-list">
                      {QC_JUDGEMENT_LABELS.map((label, i) => (
                        <li key={label}>
                          <button
                            type="button"
                            className={["pit-step", qcChecks[i] ? "pit-step--done" : ""]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() =>
                              setQcChecks((prev) => {
                                const next = [...prev];
                                next[i] = !next[i];
                                return next;
                              })
                            }
                          >
                            <span className="pit-step-box" aria-hidden>
                              {qcChecks[i] ? "✓" : ""}
                            </span>
                            <span className="pit-step-label">{label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : showWorkSurface && onBench ? (
                  <div className="pit-steps">
                    {surface.steps.map((step) => {
                      const nextOpen = surface.steps.find((s) => s.state === "open");
                      const active = nextOpen?.id === step.id;
                      return (
                        <StepRow
                          key={step.id}
                          step={step}
                          active={active}
                          onToggle={stepToggleHandler(step)}
                        />
                      );
                    })}
                  </div>
                ) : showParkedSteps ? (
                  <>
                    <SurfacePlate surface={surface} />
                    <div className="pit-steps pit-steps--parked">
                      {surface.steps.map((step) => (
                        <StepRow
                          key={step.id}
                          step={step}
                          active={false}
                          onToggle={stepToggleHandler(step)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <SurfacePlate surface={surface} />
                )}

                {surface.can_safety ? (
                  <div className="pit-safety-actions">
                    <form
                      action={async (formData) => {
                        await passSafetyCheckAction(
                          surface.work_order_id,
                          { error: null },
                          formData
                        );
                        startTransition(() => scheduleRefresh());
                      }}
                    >
                      <button type="submit" className="btn btn-primary pit-go">
                        Pass safety ✓
                      </button>
                    </form>
                    <form
                      action={async (formData) => {
                        await failSafetyCheckAction(
                          surface.work_order_id,
                          { error: null },
                          formData
                        );
                        startTransition(() => scheduleRefresh());
                      }}
                    >
                      <input
                        type="hidden"
                        name="recommendation_description"
                        value="Safety failed on floor"
                      />
                      <button type="submit" className="btn btn-secondary">
                        Fail safety
                      </button>
                    </form>
                  </div>
                ) : null}

                <div className="pit-secondary">
                  <div className="pit-secondary-actions" aria-label="Work order links">
                    <Link
                      href={techJobPacketHref(surface.work_order_id, {
                        jobId: surface.job_id ?? undefined,
                        section: "notes",
                      })}
                      className="pit-secondary-link"
                    >
                      Notes
                    </Link>
                    <Link
                      href={techJobPacketHref(surface.work_order_id, {
                        jobId: surface.job_id ?? undefined,
                        section: "photos",
                      })}
                      className="pit-secondary-link"
                    >
                      Intake photos
                    </Link>
                    {parked ? (
                      <>
                        <Link
                          href={surface.inspection_href}
                          className="pit-secondary-link"
                        >
                          Inspection
                        </Link>
                        {surface.job_id ? (
                          <button
                            type="button"
                            className="pit-secondary-link pit-secondary-link--button"
                            onClick={() => setOverlay("work")}
                          >
                            Perform work
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="pit-dock">
                <div className="pit-command">
                  <button
                    type="button"
                    className="pit-cmd pit-cmd--park"
                    disabled={!onBench || pending}
                    onClick={() => setOverlay("park")}
                  >
                    Park
                  </button>
                  <button
                    type="button"
                    className="pit-cmd pit-cmd--swap"
                    disabled={!surface.job_id || swapTargets.length === 0 || pending}
                    onClick={() => setOverlay("swap")}
                  >
                    Swap
                  </button>
                  {surface.is_qc && surface.qc_assignee_is_me ? (
                    <button
                      type="button"
                      className="pit-cmd pit-cmd--fail"
                      disabled={pending}
                      onClick={() => setOverlay("fail")}
                    >
                      Fail ✗
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="pit-go"
                    disabled={!goEnabled || pending || go?.action === "none"}
                    onClick={runGo}
                  >
                    {go?.label ?? "Go"}
                  </button>
                </div>
                {go?.sub ? <p className="pit-dock-sub">{go.sub}</p> : null}
                <ActionMessage
                  state={
                    pullState?.error
                      ? pullState
                      : ackState?.error
                        ? ackState
                        : resumeState?.error
                          ? resumeState
                          : completeState?.error
                            ? completeState
                            : toggleState?.error
                              ? toggleState
                              : installState?.error
                                ? installState
                                : proofState?.error
                                  ? proofState
                                  : null
                  }
                />
              </div>
            </>
          )}
        </section>
      </div>

      {overlay ? (
        <div
          className={["pit-overlay", overlay === "work" ? "pit-overlay--work" : ""]
            .filter(Boolean)
            .join(" ")}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="pit-scrim"
            aria-label="Close"
            onClick={() => setOverlay(null)}
          />
          <div
            className={["pit-sheet", overlay === "work" ? "pit-sheet--work-host" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {overlay === "park" && surface?.job_id ? (
              <>
                <h3 className="pit-sheet-title">Why park?</h3>
                <div className="pit-sheet-grid">
                  {PARK_REASON_OPTIONS.map((opt) => (
                    <button
                      key={opt.reason}
                      type="button"
                      className="pit-sheet-btn"
                      disabled={parkPending}
                      onClick={() =>
                        dispatchFloorAction(parkAction, {
                          job_id: surface.job_id!,
                          work_order_id: surface.work_order_id,
                          reason: opt.reason,
                        })
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {overlay === "qc_pick" && surface?.job_id ? (
              <>
                <h3 className="pit-sheet-title">Who should check your work?</h3>
                <p className="pit-sheet-or">
                  Pick a clocked-in tech. They get this bike for peer QC.
                </p>
                {surface.peer_qc_candidates.length > 0 ? (
                  <ul className="pit-sheet-list">
                    {surface.peer_qc_candidates.map((tech) => (
                      <li key={tech.user_id}>
                        <button
                          type="button"
                          className="pit-sheet-btn"
                          disabled={completePending}
                          onClick={() => completeWithQcAssignee(tech.user_id)}
                        >
                          {tech.display_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pit-sheet-or">
                    No other techs are clocked in. Front desk will cover QC.
                  </p>
                )}
                {surface.peer_qc_candidates.length === 0 ? (
                  <button
                    type="button"
                    className="pit-go"
                    disabled={completePending}
                    onClick={() => completeWithQcAssignee(null)}
                  >
                    Complete without picker ✓
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pit-sheet-close"
                  disabled={completePending}
                  onClick={() => setOverlay(null)}
                >
                  Not done yet
                </button>
                {completeState?.error ? (
                  <p className="floor-dock-msg floor-dock-msg--error" role="status">
                    {completeState.error}
                  </p>
                ) : null}
              </>
            ) : null}

            {overlay === "fail" && surface ? (
              <>
                <h3 className="pit-sheet-title">Fail peer QC</h3>
                <form action={failQcAction} className="pit-sheet-form">
                  <input
                    type="hidden"
                    name="work_order_id"
                    value={surface.work_order_id}
                  />
                  <label className="pit-sheet-label">
                    Reason
                    <textarea
                      name="reason"
                      required
                      rows={3}
                      className="pit-sheet-input"
                    />
                  </label>
                  <button type="submit" className="pit-go" disabled={failQcPending}>
                    Send back for rework
                  </button>
                </form>
              </>
            ) : null}

            {overlay === "swap" && surface?.job_id ? (
              <>
                <h3 className="pit-sheet-title">Swap onto</h3>
                <ul className="pit-sheet-list">
                  {swapTargets.map((item) => (
                    <li key={item.key}>
                      <form action={swapAction}>
                        <input type="hidden" name="from_job_id" value={surface.job_id!} />
                        <input type="hidden" name="to_job_id" value={item.job_id!} />
                        <input
                          type="hidden"
                          name="work_order_id"
                          value={item.work_order_id}
                        />
                        <button
                          type="submit"
                          className="pit-sheet-btn"
                          disabled={swapPending}
                        >
                          {item.motorcycle_label}
                          <span className="pit-sheet-btn-sub">{item.service_label}</span>
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {overlay === "proof" && surface?.job_id ? (
              <>
                <h3 className="pit-sheet-title">After photo</h3>
                <form action={proofAction} className="pit-sheet-form">
                  <input type="hidden" name="job_id" value={surface.job_id} />
                  <input
                    type="hidden"
                    name="work_order_id"
                    value={surface.work_order_id}
                  />
                  <PitPhotoField hint="Camera or photo library" />
                  <button type="submit" className="pit-go" disabled={proofPending}>
                    Upload photo ✓
                  </button>
                </form>
                <p className="pit-sheet-or">or skip with a reason</p>
                <div className="pit-sheet-grid">
                  {PROOF_SKIP_OPTIONS.map((reason) => (
                    <form key={reason} action={skipAction}>
                      <input type="hidden" name="job_id" value={surface.job_id!} />
                      <input
                        type="hidden"
                        name="work_order_id"
                        value={surface.work_order_id}
                      />
                      <input type="hidden" name="reason" value={reason} />
                      <button
                        type="submit"
                        className="pit-sheet-btn"
                        disabled={skipPending}
                      >
                        {reason}
                      </button>
                    </form>
                  ))}
                </div>
              </>
            ) : null}

            {overlay === "work" && surface?.job_id ? (
              <div className="pit-sheet--work">
                <h3 className="pit-sheet-title pit-sheet-title--compact">
                  Perform work{parked ? " — clock paused" : ""}
                </h3>
                {parked ? (
                  <p className="pit-work-view-only" role="status">
                    Clock is paused. Mark Done when work is complete, or Resume on the
                    dock when you&apos;re ready to wrench again.
                  </p>
                ) : null}
                <div className="pit-work-body">
                  {workPanel === "work" ? (
                    <div className="pit-work-brief pit-work-brief--compact">
                      <p className="pit-work-kicker">Required work</p>
                      <p className="pit-work-title pit-work-title--compact">
                        {surface.work_brief?.service_name ??
                          surface.service_name ??
                          "Job"}
                      </p>
                      {surface.work_brief?.estimated_labour != null ? (
                        <p className="pit-work-meta">
                          Est. {surface.work_brief.estimated_labour} hr
                          {Number(surface.work_brief.estimated_labour) === 1 ? "" : "s"}
                        </p>
                      ) : null}
                      {surface.work_brief?.recommendation_description ? (
                        <p className="pit-work-block pit-work-block--clamp">
                          <span className="pit-work-label">From inspection</span>
                          {surface.work_brief.recommendation_description}
                          {surface.work_brief.recommendation_notes ? (
                            <span className="pit-work-notes">
                              {surface.work_brief.recommendation_notes}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      {surface.work_brief?.job_notes ? (
                        <p className="pit-work-block pit-work-block--clamp">
                          <span className="pit-work-label">Job notes</span>
                          {surface.work_brief.job_notes}
                        </p>
                      ) : null}
                      {surface.work_brief?.technician_notes &&
                      surface.work_brief.technician_notes.length > 0 ? (
                        <p className="pit-work-note-summary">
                          {surface.work_brief.technician_notes.length} saved note
                          {surface.work_brief.technician_notes.length === 1 ? "" : "s"} —
                          tap Notes below
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {workPanel === "parts" ? (
                    <section
                      className="pit-work-parts-panel"
                      aria-labelledby="pit-work-parts-title"
                    >
                      <h4 id="pit-work-parts-title" className="pit-work-label">
                        Parts on this bike
                      </h4>
                      {surface.work_brief?.parts &&
                      surface.work_brief.parts.length > 0 ? (
                        <ul className="pit-work-parts-list">
                          {surface.work_brief.parts.map((part) => (
                            <li key={part.part_id} className="pit-work-part-row">
                              <div className="pit-work-part-main">
                                <p className="pit-work-part-name">{part.name}</p>
                                {surface.jobs.length > 1 ? (
                                  <p className="pit-work-part-service">
                                    {part.service_name}
                                  </p>
                                ) : null}
                                <p className="pit-work-part-status">
                                  {part.status_label}
                                </p>
                              </div>
                              {part.can_install ? (
                                <div className="pit-work-part-action">
                                  <button
                                    type="button"
                                    className="pit-work-part-btn pit-work-part-btn--install"
                                    disabled={installPending || parked}
                                    onClick={() =>
                                      dispatchFloorAction(installAction, {
                                        part_id: part.part_id,
                                        work_order_id: surface.work_order_id,
                                      })
                                    }
                                  >
                                    Installed
                                  </button>
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="pit-work-parts-empty">No parts</p>
                      )}
                      <div className="pit-work-parts-park">
                        <button
                          type="button"
                          className="pit-work-part-btn pit-work-part-btn--park"
                          disabled={parkPending || parked}
                          onClick={() =>
                            dispatchFloorAction(parkAction, {
                              job_id: surface.job_id!,
                              work_order_id: surface.work_order_id,
                              reason: "parts",
                            })
                          }
                        >
                          Parts not here
                        </button>
                      </div>
                      {workPartMessage ? (
                        <p
                          className={[
                            "floor-dock-msg",
                            installState?.error || parkState?.error
                              ? "floor-dock-msg--error"
                              : "floor-dock-msg--ok",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          role="status"
                        >
                          {workPartMessage}
                        </p>
                      ) : null}
                    </section>
                  ) : null}

                  {workPanel === "notes" ? (
                    <section
                      className="pit-work-notes-panel pit-work-notes-panel--open"
                      aria-labelledby="pit-work-notes-title"
                    >
                      <h4 id="pit-work-notes-title" className="pit-work-label">
                        Notes
                      </h4>
                      {surface.work_brief?.technician_notes &&
                      surface.work_brief.technician_notes.length > 0 ? (
                        <ul className="pit-work-note-list pit-work-note-list--compact">
                          {surface.work_brief.technician_notes
                            .slice(-WORK_NOTES_PREVIEW)
                            .map((techNote) => (
                              <li
                                key={techNote.technician_note_id}
                                className="pit-work-note-item"
                              >
                                <p className="pit-work-note-meta">
                                  {formatDateTime(techNote.created_at)}
                                  {techNote.author_name
                                    ? ` · ${techNote.author_name}`
                                    : ""}
                                </p>
                                <p className="pit-work-note-body pit-work-note-body--clamp">
                                  {techNote.note}
                                </p>
                              </li>
                            ))}
                        </ul>
                      ) : null}
                      {surface.work_brief?.technician_notes &&
                      surface.work_brief.technician_notes.length > WORK_NOTES_PREVIEW ? (
                        <p className="pit-work-more">
                          +
                          {surface.work_brief.technician_notes.length -
                            WORK_NOTES_PREVIEW}{" "}
                          earlier note
                          {surface.work_brief.technician_notes.length -
                            WORK_NOTES_PREVIEW ===
                          1
                            ? ""
                            : "s"}
                        </p>
                      ) : null}
                      <form action={workNoteAction} className="pit-work-note-form">
                        <input type="hidden" name="job_id" value={surface.job_id} />
                        <input
                          type="hidden"
                          name="work_order_id"
                          value={surface.work_order_id}
                        />
                        <label
                          className="pit-sheet-label pit-sheet-label--compact"
                          htmlFor="pit-work-note-input"
                        >
                          Add note
                          <textarea
                            ref={workNoteInputRef}
                            id="pit-work-note-input"
                            name="note"
                            rows={2}
                            className="pit-sheet-input pit-sheet-input--compact"
                            placeholder="What you did or found…"
                            value={workNoteDraft}
                            onChange={(event) => {
                              setWorkNoteDraft(event.target.value);
                              if (workNoteSaved) setWorkNoteSaved(null);
                            }}
                          />
                        </label>
                        <button
                          type="submit"
                          className="pit-sheet-save pit-sheet-save--compact"
                          disabled={workNotePending || !workNoteDraft.trim()}
                        >
                          Save
                        </button>
                        {workNoteState?.error ? (
                          <p
                            className="floor-dock-msg floor-dock-msg--error"
                            role="status"
                          >
                            {workNoteState.error}
                          </p>
                        ) : null}
                        {workNoteSaved ? (
                          <p className="floor-dock-msg floor-dock-msg--ok" role="status">
                            {workNoteSaved}
                          </p>
                        ) : null}
                      </form>
                    </section>
                  ) : null}
                </div>

                <div className="pit-work-footer">
                  <p className="pit-work-photo-status" role="status">
                    {workPhotoLabel ? `Photo ready — ${workPhotoLabel}` : "\u00a0"}
                  </p>
                  <form
                    id="pit-work-complete-form"
                    action={workAction}
                    className="pit-work-complete-form"
                  >
                    <input type="hidden" name="job_id" value={surface.job_id} />
                    <input
                      type="hidden"
                      name="work_order_id"
                      value={surface.work_order_id}
                    />
                    <input type="hidden" name="item_id" value={openPerformWorkItemId} />
                    <PitPhotoField
                      ref={workPhotoRef}
                      variant="dock"
                      hint=""
                      onPhotoReady={setWorkPhotoLabel}
                    />
                  </form>
                  <div
                    className="pit-work-dock"
                    role="toolbar"
                    aria-label="Perform work actions"
                  >
                    <button
                      type="button"
                      className={[
                        "pit-work-dock-btn",
                        workPanel === "work" ? "pit-work-dock-btn--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={workPanel === "work"}
                      onClick={() => {
                        setWorkPanel("work");
                        setWorkPartMessage(null);
                      }}
                    >
                      <PitDockIcon label="Work">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                        </svg>
                      </PitDockIcon>
                    </button>
                    <button
                      type="button"
                      className={[
                        "pit-work-dock-btn",
                        workPanel === "parts" ? "pit-work-dock-btn--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={workPanel === "parts"}
                      onClick={() => {
                        setWorkPanel("parts");
                        setWorkPartMessage(null);
                      }}
                    >
                      <PitDockIcon label="Parts">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                          <path d="M3.3 7.7 12 12.5l8.7-4.8M12 22V12.5" />
                        </svg>
                      </PitDockIcon>
                    </button>
                    <button
                      type="button"
                      className="pit-work-dock-btn"
                      onClick={() => workPhotoRef.current?.openCamera()}
                      disabled={parked}
                      aria-label="Add photo"
                    >
                      <PitDockIcon label="Camera">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
                          <circle cx="12" cy="13" r="3.5" />
                        </svg>
                      </PitDockIcon>
                    </button>
                    <button
                      type="button"
                      className="pit-work-dock-btn"
                      onClick={() => workPhotoRef.current?.openLibrary()}
                      disabled={parked}
                      aria-label="Choose from library"
                    >
                      <PitDockIcon label="Library">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect x="3" y="5" width="14" height="14" rx="2" />
                          <path d="M7 19h12a2 2 0 0 0 2-2V7" />
                        </svg>
                      </PitDockIcon>
                    </button>
                    <button
                      type="button"
                      className={[
                        "pit-work-dock-btn",
                        workPanel === "notes" ? "pit-work-dock-btn--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={workPanel === "notes"}
                      aria-controls="pit-work-notes-title"
                      onClick={() => {
                        setWorkPanel("notes");
                        setWorkPartMessage(null);
                        window.requestAnimationFrame(() =>
                          workNoteInputRef.current?.focus()
                        );
                      }}
                    >
                      <PitDockIcon label="Notes">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M6 4h9l3 3v13H6z" />
                          <path d="M15 4v3h3M8 12h8M8 16h6" />
                        </svg>
                      </PitDockIcon>
                    </button>
                    <button
                      type="submit"
                      form="pit-work-complete-form"
                      className="pit-work-dock-btn pit-work-dock-btn--done"
                      disabled={workPending || !openPerformWorkItemId}
                      aria-label="Mark done"
                    >
                      <PitDockIcon label="Done">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      </PitDockIcon>
                    </button>
                    <button
                      type="button"
                      className="pit-work-dock-btn"
                      onClick={() => setOverlay(null)}
                      aria-label="Not done yet"
                    >
                      <PitDockIcon label="Close">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </PitDockIcon>
                    </button>
                  </div>
                  {workState?.error ? (
                    <p
                      className="floor-dock-msg floor-dock-msg--error pit-work-error"
                      role="status"
                    >
                      {workState.error}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
