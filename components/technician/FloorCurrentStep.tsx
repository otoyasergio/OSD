"use client";

import {
  Camera,
  Check,
  ClipboardCheck,
  Package,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { FloorOsSurface } from "@/lib/services/technicianFloor";
import type { FloorStage } from "@/lib/technician/floorStage";
import {
  PROOF_SKIP_OPTIONS,
  QC_JUDGEMENT_LABELS,
  isFloorJobFinished,
  type PitBoardStep,
} from "@/lib/technician/pitBoard";
import { buildFloorCompletionSummary } from "@/lib/technician/floorCompletionSummary";
import { FloorPhotoField } from "@/components/technician/FloorPhotoField";

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
      {hasPending ? (
        <div className="pit-completion-pending">
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
      body: "It's in your line. Tap Start this bike when you're ready — that's when your clock starts.",
    };
  }
  if (s.job_status === "waiting_for_approval") {
    return {
      kicker: "WAITING FOR CLIENT APPROVAL",
      title: "Front desk owns this wait",
      body: "This job still needs a client yes. Once approved, it lands back in your line.",
    };
  }
  if (s.board_status === "waiting") {
    return {
      kicker: `PARKED — ${s.park_reason_label.toUpperCase()}`,
      title: "Clock paused — your spot is saved",
      body: `${s.wait_owner_label}. Resume when you're ready to wrench.`,
    };
  }
  if (s.board_status === "next") {
    return {
      kicker: "IN YOUR LINE — NOT STARTED",
      title: "Ready when you are",
      body: "Start this bike to start the clock. Anything already on the bench parks itself.",
    };
  }
  if (s.board_status === "done") {
    return {
      kicker: "COMPLETE",
      title: "Your wrench work is done",
      body: "Here's the rest of its trip — none of it is yours unless it bounces back.",
      pipe: ["WRENCH", "PEER QC", "SAFETY", "PICKUP"],
    };
  }
  if (s.is_safety) {
    return {
      kicker: "HEAD-TECH SAFETY",
      title: s.can_safety ? "Final safety call" : "Waiting on head tech",
      body: s.can_safety
        ? "Pass or fail below. Front desk books pickup after pass."
        : "You're done unless this bike is assigned to you for safety.",
      pipe: ["WRENCH", "PEER QC", "SAFETY", "PICKUP"],
    };
  }
  return null;
}

export function FloorCurrentStep({
  surface,
  activeStage,
  currentStep,
  remainingCount,
  parked,
  qcChecks,
  onToggleQc,
  onOpenInspection,
  onCompleteWork,
  onToggleChecklist,
  onInstallPart,
  onParkParts,
  proofAction,
  skipAction,
  proofPending,
  skipPending,
  workPending,
}: {
  surface: FloorOsSurface;
  activeStage: FloorStage;
  currentStep: PitBoardStep | null;
  remainingCount: number;
  parked: boolean;
  qcChecks: boolean[];
  onToggleQc: (index: number) => void;
  onOpenInspection: () => void;
  onCompleteWork: () => void;
  onToggleChecklist: (itemId: string, label: string) => void;
  onInstallPart: (partId: string, label: string) => void;
  onParkParts: () => void;
  proofAction: (payload: FormData) => void;
  skipAction: (payload: FormData) => void;
  proofPending: boolean;
  skipPending: boolean;
  workPending: boolean;
}) {
  const finished = isFloorJobFinished({
    board_status: surface.board_status,
    job_status: surface.job_status,
    completed_at: surface.completed_at,
  });
  const plate = plateFor(surface);
  const showInspect = activeStage === "inspect" || currentStep?.kind === "inspect";
  const showProof = activeStage === "proof" || currentStep?.kind === "proof";
  const showWork =
    !showInspect &&
    !showProof &&
    (activeStage === "work" ||
      currentStep?.kind === "work" ||
      currentStep?.kind === "checklist" ||
      currentStep?.kind === "part");
  const showDone = activeStage === "done" || currentStep?.kind === "complete";

  if (surface.is_qc && surface.qc_assignee_is_me) {
    return (
      <div className="pit-qc pit-current-card">
        <ShieldCheck className="pit-current-hero-icon" size={36} aria-hidden />
        <p className="pit-plate-kicker">PEER QC — VOUCH FOR THIS BIKE</p>
        <ul className="pit-qc-list">
          {QC_JUDGEMENT_LABELS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                className={["pit-step", qcChecks[i] ? "pit-step--done" : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onToggleQc(i)}
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
    );
  }

  if (surface.board_status !== "bench" && !parked) {
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

  return (
    <div className="pit-current">
      {parked && plate ? (
        <Plate kicker={plate.kicker} title={plate.title} body={plate.body} />
      ) : null}

      {showInspect ? (
        <button type="button" className="pit-current-card" onClick={onOpenInspection}>
          <ClipboardCheck className="pit-current-hero-icon" size={40} aria-hidden />
          <p className="pit-current-kicker">
            {surface.inspection_complete ? "Review" : "Step 1"}
          </p>
          <h3 className="pit-current-title">
            {surface.inspection_complete ? "Inspection complete" : "Open inspection"}
          </h3>
          <p className="pit-current-body">
            {surface.inspection_complete
              ? "Tap to view the report, then keep pushing the bike."
              : "Fullscreen checklist — you come straight back to Work when the report is done."}
          </p>
        </button>
      ) : null}

      {showWork && currentStep?.kind === "work" ? (
        <div className="pit-current-card">
          <Wrench className="pit-current-hero-icon" size={40} aria-hidden />
          <p className="pit-current-kicker">Required work</p>
          <h3 className="pit-current-title">
            {surface.work_brief?.service_name ?? surface.service_name ?? "Perform work"}
          </h3>
          {surface.work_brief?.recommendation_description ? (
            <p className="pit-current-body">
              {surface.work_brief.recommendation_description}
            </p>
          ) : (
            <p className="pit-current-body">
              Do the work, then tap Next. Photo optional — notes live under the note icon.
            </p>
          )}
          <button
            type="button"
            className="pit-current-action"
            disabled={workPending}
            onClick={onCompleteWork}
          >
            Mark work done
          </button>
        </div>
      ) : null}

      {showWork && currentStep?.kind === "checklist" && currentStep.target_id ? (
        <button
          type="button"
          className="pit-current-card"
          onClick={() => onToggleChecklist(currentStep.target_id!, currentStep.label)}
        >
          <Check className="pit-current-hero-icon" size={40} aria-hidden />
          <p className="pit-current-kicker">Checklist</p>
          <h3 className="pit-current-title">{currentStep.label}</h3>
          <p className="pit-current-body">Tap to check this off and move forward.</p>
        </button>
      ) : null}

      {showWork && currentStep?.kind === "part" && currentStep.target_id ? (
        <div className="pit-current-card">
          <Package className="pit-current-hero-icon" size={40} aria-hidden />
          <p className="pit-current-kicker">{currentStep.tag ?? "Part"}</p>
          <h3 className="pit-current-title">{currentStep.label}</h3>
          <div className="pit-current-actions">
            <button
              type="button"
              className="pit-current-action"
              onClick={() => onInstallPart(currentStep.target_id!, currentStep.label)}
            >
              Installed
            </button>
            <button
              type="button"
              className="pit-current-action-secondary"
              onClick={onParkParts}
            >
              Parts not here
            </button>
          </div>
        </div>
      ) : null}

      {showProof && surface.job_id ? (
        <div className="pit-current-card">
          <Camera className="pit-current-hero-icon" size={40} aria-hidden />
          <p className="pit-current-kicker">After photo</p>
          <h3 className="pit-current-title">Show the finished bike</h3>
          <p className="pit-current-body">
            Photo encouraged — skip with a reason if you need to.
          </p>
          <form action={proofAction} className="pit-sheet-form">
            <input type="hidden" name="job_id" value={surface.job_id} />
            <input type="hidden" name="work_order_id" value={surface.work_order_id} />
            <FloorPhotoField hint="Camera or photo library" />
            <button type="submit" className="pit-current-action" disabled={proofPending}>
              Upload photo
            </button>
          </form>
          <p className="pit-sheet-or">or skip</p>
          <div className="pit-sheet-grid">
            {PROOF_SKIP_OPTIONS.map((reason) => (
              <form key={reason} action={skipAction}>
                <input type="hidden" name="job_id" value={surface.job_id!} />
                <input type="hidden" name="work_order_id" value={surface.work_order_id} />
                <input type="hidden" name="reason" value={reason} />
                <button type="submit" className="pit-sheet-btn" disabled={skipPending}>
                  {reason}
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}

      {showDone ? (
        <div className="pit-current-card">
          <Check className="pit-current-hero-icon" size={40} aria-hidden />
          <p className="pit-current-kicker">Wrap up</p>
          <h3 className="pit-current-title">Complete job</h3>
          <p className="pit-current-body">
            {surface.complete_gate_ok
              ? "Next picks who checks your work. Your clock stops."
              : (surface.complete_gate_reason ?? "Finish the open steps first.")}
          </p>
          <CompletionSummary surface={surface} />
        </div>
      ) : null}

      {remainingCount > 0 && surface.board_status === "bench" ? (
        <p className="pit-current-remaining">
          {remainingCount} more step{remainingCount === 1 ? "" : "s"} after this
        </p>
      ) : null}
    </div>
  );
}
