"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { FloorOsSurface, TechnicianFloorOs } from "@/lib/services/technicianFloor";
import type { DocketItem } from "@/lib/services/technicianDocket";
import type { ReadyForPickupItem } from "@/lib/services/readyForPickup";
import { TechnicianDocketList } from "@/components/technician/TechnicianDocketList";
import { ReadyForPickupCarousel } from "@/components/technician/ReadyForPickupCarousel";
import {
  addProofExceptionAction,
  completeJobFloorAction,
  failPeerQcAction,
  flagForAdminAction,
  installPartFloorAction,
  passPeerQcAction,
  pauseJobFloorAction,
  pullJobAction,
  resumeJobFloorAction,
  startJobFloorAction,
  toggleChecklistAction,
  uploadJobProofAction,
  type FloorActionState,
} from "@/app/(app)/technician/floor-actions";
import {
  failSafetyCheckAction,
  passSafetyCheckAction,
  type SafetyFormState,
} from "@/app/(app)/work_orders/safety-actions";
import {
  techJobPacketHref,
  type JobPacketSection,
} from "@/lib/technician/assignmentHref";
import type { JobPacket } from "@/lib/services/jobPacket";
import type { IntakePhoto } from "@/lib/services/photos";
import { JobPacketPanel } from "@/components/technician/JobPacketPanel";
import { deriveDefaultStage, type FloorStage } from "@/lib/technician/floorStage";

function closePacketHref(
  workOrderId: string,
  jobId: string | null | undefined,
  stage: FloorStage
): string {
  const params = new URLSearchParams();
  params.set("wo", workOrderId);
  if (jobId) params.set("job", jobId);
  params.set("stage", stage);
  return `/technician?${params.toString()}`;
}

function JobPacketErrorState({ backHref }: { backHref: string }) {
  return (
    <div className="floor-surface-empty floor-packet-error">
      <h2 className="floor-section-title">Couldn&apos;t open job packet</h2>
      <p className="floor-muted">
        This work order may be unavailable or you may not have access.
      </p>
      <Link href={backHref} className="btn btn-secondary floor-tap floor-tap--wide">
        Back to floor
      </Link>
    </div>
  );
}

export type { FloorStage };
export { deriveDefaultStage };

function jobHref(workOrderId: string, jobId: string): string {
  const params = new URLSearchParams();
  params.set("job", jobId);
  params.set("wo", workOrderId);
  return `/technician?${params.toString()}`;
}

function stageHref(surface: FloorOsSurface, stage: FloorStage): string {
  const params = new URLSearchParams();
  if (surface.job_id) params.set("job", surface.job_id);
  params.set("wo", surface.work_order_id);
  params.set("stage", stage);
  return `/technician?${params.toString()}`;
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

function StageRail({ surface, stage }: { surface: FloorOsSurface; stage: FloorStage }) {
  if (
    stage === "safety" ||
    (surface.is_safety && surface.can_safety && !surface.job_id)
  ) {
    return (
      <div className="floor-stage-rail" aria-label="Safety check">
        <span className="floor-stage-pill floor-stage-pill--current">Safety</span>
      </div>
    );
  }
  if (stage === "qc" || (surface.is_qc && surface.qc_assignee_is_me && !surface.job_id)) {
    return (
      <div className="floor-stage-rail" aria-label="Quality check">
        <span className="floor-stage-pill floor-stage-pill--current">Peer QC</span>
      </div>
    );
  }

  const inspectDone = surface.inspection_complete;
  const workDone =
    surface.checklist.length > 0 &&
    surface.checklist.every((item) => item.checked_at) &&
    !surface.parts.some((part) => part.can_install);
  const proofDone = surface.proof_count > 0 || surface.has_proof_exception;

  const stages: Array<{ id: FloorStage; label: string; done: boolean }> = [
    { id: "inspect", label: "Inspect", done: inspectDone },
    { id: "work", label: "Work", done: workDone },
    { id: "proof", label: "Proof", done: proofDone },
    { id: "done", label: "Done", done: false },
  ];

  return (
    <nav className="floor-stage-rail" aria-label="Job stages">
      {stages.map((s, index) => {
        const current = stage === s.id;
        return (
          <div key={s.id} className="floor-stage-item">
            {index > 0 ? (
              <span className="floor-stage-arrow" aria-hidden>
                →
              </span>
            ) : null}
            <Link
              href={stageHref(surface, s.id)}
              className={[
                "floor-stage-pill",
                current ? "floor-stage-pill--current" : "",
                s.done && !current ? "floor-stage-pill--done" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={current ? "step" : undefined}
            >
              <span className="floor-stage-num">{index + 1}</span>
              {s.label}
              {s.done ? " ✓" : ""}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

function MotorcycleServices({ surface }: { surface: FloorOsSurface }) {
  if (surface.jobs.length === 0) return null;

  return (
    <section className="floor-services" aria-labelledby="floor-services-title">
      <h3 id="floor-services-title" className="floor-section-title">
        Services on this motorcycle
      </h3>
      <ul className="floor-service-list">
        {surface.jobs.map((job) => {
          const content = (
            <>
              <span className="floor-service-main">
                <span className="floor-service-name">{job.service_name}</span>
                <span className="floor-service-meta">{job.status_label}</span>
              </span>
              <span className="floor-service-owner">
                {job.assigned_to_me
                  ? job.is_selected
                    ? "Open"
                    : "My service"
                  : "Other tech"}
              </span>
            </>
          );

          return (
            <li key={job.job_id}>
              {job.assigned_to_me ? (
                <Link
                  href={jobHref(surface.work_order_id, job.job_id)}
                  className={`floor-service-item${
                    job.is_selected ? " floor-service-item--selected" : ""
                  }`}
                  aria-current={job.is_selected ? "true" : undefined}
                >
                  {content}
                </Link>
              ) : (
                <div className="floor-service-item floor-service-item--other">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FlagForm({
  surface,
  flagAction,
  flagPending,
  flagState,
}: {
  surface: FloorOsSurface;
  flagAction: (payload: FormData) => void;
  flagPending: boolean;
  flagState: FloorActionState;
}) {
  return (
    <details className="floor-flag-details">
      <summary className="floor-flag-summary">Flag</summary>
      <form action={flagAction} className="floor-flag-form">
        <input type="hidden" name="job_id" value={surface.job_id ?? ""} />
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <select name="reason" required className="input" defaultValue="parts">
          <option value="parts">Parts</option>
          <option value="approval">Approval</option>
          <option value="tool">Tool</option>
          <option value="quality">Quality</option>
          <option value="other">Other</option>
        </select>
        <textarea name="note" rows={2} placeholder="Optional note" className="input" />
        <button
          className="btn btn-secondary floor-tap"
          disabled={flagPending}
          type="submit"
        >
          {flagPending ? "Flagging…" : "Raise flag"}
        </button>
        <ActionMessage state={flagState} />
      </form>
    </details>
  );
}

function InspectStage({ surface }: { surface: FloorOsSurface }) {
  return (
    <div className="floor-stage-body">
      <p className="floor-lead">
        {surface.inspection_complete
          ? "Inspection is complete. Continue to Work."
          : "Complete the visual inspection before finishing jobs."}
      </p>
      <Link
        href={surface.inspection_href}
        className="btn btn-primary floor-tap floor-tap--wide"
      >
        {surface.inspection_complete ? "View inspection" : "Open inspection"}
      </Link>
      {surface.inspection_complete ? (
        <Link
          href={stageHref(surface, "work")}
          className="btn btn-secondary floor-tap floor-tap--wide"
        >
          Continue to Work →
        </Link>
      ) : null}
    </div>
  );
}

function WorkStage({ surface }: { surface: FloorOsSurface }) {
  const [checkState, checkAction] = useActionState(toggleChecklistAction, null);
  const [partState, partAction, partPending] = useActionState(
    installPartFloorAction,
    null
  );

  return (
    <div className="floor-stage-body">
      <section>
        <h3 className="floor-section-title">Standard work</h3>
        <ul className="floor-checklist">
          {surface.checklist.map((item) => (
            <li key={item.job_checklist_item_id}>
              <form action={checkAction} className="floor-checklist-row">
                <input type="hidden" name="item_id" value={item.job_checklist_item_id} />
                <input type="hidden" name="work_order_id" value={surface.work_order_id} />
                <input
                  type="hidden"
                  name="checked"
                  value={item.checked_at ? "false" : "true"}
                />
                <button
                  type="submit"
                  className={`floor-check ${item.checked_at ? "floor-check--on" : ""}`}
                  aria-pressed={Boolean(item.checked_at)}
                  aria-label={item.title}
                >
                  {item.checked_at ? "✓" : ""}
                </button>
                <span className="floor-checklist-label">{item.title}</span>
              </form>
            </li>
          ))}
        </ul>
        <ActionMessage state={checkState} />
      </section>

      <section>
        <h3 className="floor-section-title">Parts</h3>
        {surface.parts.length === 0 ? (
          <p className="floor-muted">No parts on this job.</p>
        ) : (
          <ul className="floor-parts">
            {surface.parts.map((part) => (
              <li key={part.part_id} className="floor-part-row">
                <div>
                  <div className="floor-part-name">{part.name}</div>
                  <div className="floor-muted">{part.status}</div>
                </div>
                {part.can_install ? (
                  <form action={partAction}>
                    <input type="hidden" name="part_id" value={part.part_id} />
                    <input
                      type="hidden"
                      name="work_order_id"
                      value={surface.work_order_id}
                    />
                    <button
                      className="btn btn-secondary floor-tap"
                      disabled={partPending}
                    >
                      Install
                    </button>
                  </form>
                ) : (
                  <span className="floor-part-done">Done</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <ActionMessage state={partState} />
      </section>

      <Link
        href={stageHref(surface, "proof")}
        className="btn btn-secondary floor-tap floor-tap--wide"
      >
        Continue to Proof →
      </Link>
    </div>
  );
}

function ProofStage({ surface }: { surface: FloorOsSurface }) {
  const [proofState, proofAction, proofPending] = useActionState(
    uploadJobProofAction,
    null
  );
  const [exceptionState, exceptionAction] = useActionState(addProofExceptionAction, null);

  if (!surface.job_id) {
    return <p className="floor-muted">Select a job first.</p>;
  }

  return (
    <div className="floor-stage-body">
      <p className="floor-lead">
        {surface.proof_count > 0
          ? `${surface.proof_count} after photo(s) on file.`
          : surface.has_proof_exception
            ? "Proof exception on file."
            : "Add an after photo, or note why proof isn’t available."}
      </p>

      <form action={proofAction} className="floor-proof-upload">
        <input type="hidden" name="job_id" value={surface.job_id} />
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <input
          type="file"
          name="file"
          accept="image/*"
          capture="environment"
          className="input"
          required
        />
        <button className="btn btn-primary floor-tap" disabled={proofPending}>
          {proofPending ? "Uploading…" : "Upload proof photo"}
        </button>
      </form>
      <ActionMessage state={proofState} />

      <details className="floor-flag-details">
        <summary className="floor-flag-summary">Can’t take a photo?</summary>
        <form action={exceptionAction} className="floor-flag-form">
          <input type="hidden" name="job_id" value={surface.job_id} />
          <input type="hidden" name="work_order_id" value={surface.work_order_id} />
          <textarea
            name="note"
            required
            rows={2}
            placeholder="Why no after photo"
            className="input"
          />
          <button className="btn btn-secondary floor-tap" type="submit">
            Save exception
          </button>
          <ActionMessage state={exceptionState} />
        </form>
      </details>

      <Link
        href={stageHref(surface, "done")}
        className="btn btn-secondary floor-tap floor-tap--wide"
      >
        Continue to Done →
      </Link>
    </div>
  );
}

function DoneStage({ surface, stage }: { surface: FloorOsSurface; stage: FloorStage }) {
  return (
    <div className="floor-stage-body">
      <h3 className="floor-section-title">Ready to finish?</h3>
      <ul className="floor-gate-list">
        <li className={surface.inspection_complete ? "floor-gate-ok" : "floor-gate-miss"}>
          {surface.inspection_complete ? "✓" : "○"} Inspection
        </li>
        <li
          className={
            surface.checklist.every((i) => i.checked_at) && surface.checklist.length > 0
              ? "floor-gate-ok"
              : "floor-gate-miss"
          }
        >
          {surface.checklist.every((i) => i.checked_at) && surface.checklist.length > 0
            ? "✓"
            : "○"}{" "}
          Checklist
        </li>
        <li
          className={
            !surface.parts.some((p) => p.can_install)
              ? "floor-gate-ok"
              : "floor-gate-miss"
          }
        >
          {!surface.parts.some((p) => p.can_install) ? "✓" : "○"} Parts
        </li>
        <li
          className={
            surface.proof_count > 0 || surface.has_proof_exception
              ? "floor-gate-ok"
              : "floor-gate-miss"
          }
        >
          {surface.proof_count > 0 || surface.has_proof_exception ? "✓" : "○"} Proof
        </li>
      </ul>
      {!surface.complete_gate_ok && surface.can_complete ? (
        <p className="floor-gate-reason">{surface.complete_gate_reason}</p>
      ) : (
        <p className="floor-muted">Use the dock below to start or complete this job.</p>
      )}
      <Link
        href={techJobPacketHref(surface.work_order_id, {
          jobId: surface.job_id ?? undefined,
          section: "notes",
          stage,
        })}
        className="btn btn-secondary floor-tap floor-tap--wide"
      >
        Open notes
      </Link>
    </div>
  );
}

function QcStage({ surface, stage }: { surface: FloorOsSurface; stage: FloorStage }) {
  if (!surface.is_qc) {
    return <p className="floor-muted">No peer QC on this work order yet.</p>;
  }
  if (!surface.qc_assignee_is_me) {
    return <p className="floor-muted">This QC is assigned to another technician.</p>;
  }

  return (
    <div className="floor-stage-body">
      <p className="floor-lead">
        Confirm {surface.motorcycle_label} meets shop standard, then pass or fail from the
        dock.
      </p>
      <ul className="floor-checklist">
        <li className="floor-checklist-row">
          <span className="floor-check floor-check--on" aria-hidden>
            ✓
          </span>
          <span className="floor-checklist-label">Jobs completed as approved</span>
        </li>
        <li className="floor-checklist-row">
          <span className="floor-check floor-check--on" aria-hidden>
            ✓
          </span>
          <span className="floor-checklist-label">Proof photos / notes look right</span>
        </li>
        <li className="floor-checklist-row">
          <span className="floor-check floor-check--on" aria-hidden>
            ✓
          </span>
          <span className="floor-checklist-label">Bike is safe to return</span>
        </li>
      </ul>
      <p className="floor-muted">
        <Link
          href={techJobPacketHref(surface.work_order_id, {
            jobId: surface.job_id ?? undefined,
            stage,
          })}
        >
          Open job packet
        </Link>{" "}
        for notes, photos, and sibling jobs. Pass or Fail from the dock below.
      </p>
    </div>
  );
}

function SafetyStage({ surface }: { surface: FloorOsSurface }) {
  if (!surface.is_safety) {
    return <p className="floor-muted">No safety check on this work order yet.</p>;
  }
  if (!surface.can_safety) {
    return <p className="floor-muted">Only Head Tech can pass or fail safety.</p>;
  }

  return (
    <div className="floor-stage-body">
      <p className="floor-lead">
        Review the inspection report for {surface.motorcycle_label}, then pass or fail
        safety from the dock.
      </p>
      <Link
        href={surface.inspection_href}
        className="btn btn-secondary floor-tap floor-tap--wide"
      >
        Open inspection report
      </Link>
      <p className="floor-muted">
        Fail requires a recommendation — the visit returns to customer approval.
      </p>
    </div>
  );
}

function StickyDock({ surface, stage }: { surface: FloorOsSurface; stage: FloorStage }) {
  const [startState, startAction, startPending] = useActionState(
    startJobFloorAction,
    null
  );
  const [completeState, completeAction, completePending] = useActionState(
    completeJobFloorAction,
    null
  );
  const [pauseState, pauseAction, pausePending] = useActionState(
    pauseJobFloorAction,
    null
  );
  const [resumeState, resumeAction, resumePending] = useActionState(
    resumeJobFloorAction,
    null
  );
  const [pullState, pullAction, pullPending] = useActionState(pullJobAction, null);
  const [flagState, flagAction, flagPending] = useActionState(flagForAdminAction, null);
  const [passState, passAction, passPending] = useActionState(passPeerQcAction, null);
  const [failState, failAction, failPending] = useActionState(failPeerQcAction, null);
  const [passSafetyState, passSafetyAction, passSafetyPending] = useActionState(
    (prev: SafetyFormState, formData: FormData) =>
      passSafetyCheckAction(surface.work_order_id, prev, formData),
    { error: null }
  );
  const [failSafetyState, failSafetyAction, failSafetyPending] = useActionState(
    (prev: SafetyFormState, formData: FormData) =>
      failSafetyCheckAction(surface.work_order_id, prev, formData),
    { error: null }
  );

  const showFlag =
    Boolean(surface.job_id) && !surface.can_pull && stage !== "qc" && stage !== "safety";
  const checklistOpen = surface.checklist.some((item) => !item.checked_at);
  const partsOpen = surface.parts.some((part) => part.can_install);
  const proofOk = surface.proof_count > 0 || surface.has_proof_exception;
  const workReady = surface.inspection_complete && !checklistOpen && !partsOpen;

  let primary: ReactNode = null;
  let secondary: ReactNode = null;
  let reason: string | null = null;

  if (surface.can_pull && surface.job_id) {
    primary = (
      <form action={pullAction} className="floor-dock-primary">
        <input type="hidden" name="job_id" value={surface.job_id} />
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <button className="btn btn-primary floor-dock-btn" disabled={pullPending}>
          {pullPending ? "Pulling…" : "Pull job"}
        </button>
        <ActionMessage state={pullState} />
      </form>
    );
  } else if (stage === "safety" && surface.can_safety) {
    primary = (
      <form action={passSafetyAction} className="floor-dock-primary">
        <input
          type="hidden"
          name="safety_check_notes"
          value="Safety checklist reviewed"
        />
        <button className="btn btn-primary floor-dock-btn" disabled={passSafetyPending}>
          {passSafetyPending ? "Passing…" : "Pass safety"}
        </button>
        {passSafetyState.error ? (
          <p className="floor-dock-msg floor-dock-msg--error" role="status">
            {passSafetyState.error}
          </p>
        ) : null}
      </form>
    );
    secondary = (
      <details className="floor-flag-details floor-dock-fail">
        <summary className="floor-flag-summary">Fail safety</summary>
        <form action={failSafetyAction} className="floor-flag-form">
          <textarea
            name="recommendation_description"
            required
            rows={2}
            placeholder="Recommendation for customer approval"
            className="input"
          />
          <select
            name="recommendation_severity"
            className="input"
            defaultValue="immediate_attention"
          >
            <option value="future_attention">Future attention</option>
            <option value="immediate_attention">Immediate attention</option>
            <option value="safety_critical">Safety critical</option>
          </select>
          <textarea
            name="safety_check_notes"
            rows={2}
            placeholder="Safety notes (optional)"
            className="input"
          />
          <button className="btn btn-secondary floor-tap" disabled={failSafetyPending}>
            {failSafetyPending ? "Failing…" : "Confirm fail"}
          </button>
          {failSafetyState.error ? (
            <p className="floor-dock-msg floor-dock-msg--error" role="status">
              {failSafetyState.error}
            </p>
          ) : null}
        </form>
      </details>
    );
  } else if (stage === "qc" && surface.qc_assignee_is_me) {
    primary = (
      <form action={passAction} className="floor-dock-primary">
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <input type="hidden" name="notes" value="Peer QC checklist reviewed" />
        <button className="btn btn-primary floor-dock-btn" disabled={passPending}>
          {passPending ? "Passing…" : "Pass QC"}
        </button>
        <ActionMessage state={passState} />
      </form>
    );
    secondary = (
      <details className="floor-flag-details floor-dock-fail">
        <summary className="floor-flag-summary">Fail QC</summary>
        <form action={failAction} className="floor-flag-form">
          <input type="hidden" name="work_order_id" value={surface.work_order_id} />
          <textarea
            name="reason"
            required
            rows={2}
            placeholder="What failed?"
            className="input"
          />
          <button className="btn btn-secondary floor-tap" disabled={failPending}>
            {failPending ? "Failing…" : "Confirm fail"}
          </button>
          <ActionMessage state={failState} />
        </form>
      </details>
    );
  } else if (stage === "inspect" && !surface.inspection_complete) {
    primary = (
      <Link href={surface.inspection_href} className="btn btn-primary floor-dock-btn">
        Open inspection
      </Link>
    );
  } else if (stage === "inspect" && surface.inspection_complete) {
    primary = (
      <Link href={stageHref(surface, "work")} className="btn btn-primary floor-dock-btn">
        Continue to Work →
      </Link>
    );
  } else if (stage === "work" && surface.can_start && surface.job_id) {
    primary = (
      <form action={startAction} className="floor-dock-primary">
        <input type="hidden" name="job_id" value={surface.job_id} />
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <button className="btn btn-primary floor-dock-btn" disabled={startPending}>
          {startPending ? "Starting…" : "Start job"}
        </button>
        <ActionMessage state={startState} />
      </form>
    );
  } else if (stage === "work" && workReady) {
    secondary =
      surface.job_id && surface.can_complete ? (
        surface.job_timer_running ? (
          <form action={pauseAction}>
            <input type="hidden" name="work_order_id" value={surface.work_order_id} />
            <button className="btn btn-secondary floor-dock-btn" disabled={pausePending}>
              {pausePending ? "Pausing…" : "Pause timer"}
            </button>
            <ActionMessage state={pauseState} />
          </form>
        ) : (
          <form action={resumeAction}>
            <input type="hidden" name="job_id" value={surface.job_id} />
            <input type="hidden" name="work_order_id" value={surface.work_order_id} />
            <button className="btn btn-secondary floor-dock-btn" disabled={resumePending}>
              {resumePending ? "Resuming…" : "Resume timer"}
            </button>
            <ActionMessage state={resumeState} />
          </form>
        )
      ) : null;
    primary = (
      <Link href={stageHref(surface, "proof")} className="btn btn-primary floor-dock-btn">
        Continue to Proof →
      </Link>
    );
  } else if (stage === "proof" && proofOk) {
    primary = (
      <Link href={stageHref(surface, "done")} className="btn btn-primary floor-dock-btn">
        Continue to Done →
      </Link>
    );
  } else if (
    (stage === "done" || stage === "proof" || stage === "work") &&
    surface.can_complete &&
    surface.job_id
  ) {
    reason = surface.complete_gate_ok ? null : surface.complete_gate_reason;
    primary = (
      <form action={completeAction} className="floor-dock-primary">
        <input type="hidden" name="job_id" value={surface.job_id} />
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <button
          className="btn btn-primary floor-dock-btn"
          disabled={completePending || !surface.complete_gate_ok}
        >
          {completePending ? "Completing…" : "Complete job"}
        </button>
        <ActionMessage state={completeState} />
      </form>
    );
  }

  if (!primary && !secondary && !showFlag) return null;

  return (
    <div className="floor-dock">
      {reason ? <p className="floor-gate-reason">{reason}</p> : null}
      <div className="floor-dock-row">
        {showFlag ? (
          <FlagForm
            surface={surface}
            flagAction={flagAction}
            flagPending={flagPending}
            flagState={flagState}
          />
        ) : null}
        {secondary}
        {primary}
      </div>
    </div>
  );
}

export function TechnicianFloorShell({
  floor,
  stage: stageProp,
  docketItems = [],
  readyForPickup = [],
  panel = null,
  packet = null,
  packetSection = null,
  packetPhotos = [],
  packetWorkOrderId = null,
  packetJobId = null,
}: {
  floor: TechnicianFloorOs;
  stage?: FloorStage | null;
  docketItems?: DocketItem[];
  readyForPickup?: ReadyForPickupItem[];
  /** Job packet panel routing. */
  panel?: "packet" | null;
  packet?: JobPacket | null;
  packetSection?: JobPacketSection | null;
  /** Intake/proof photos — loaded only when packetSection=photos. */
  packetPhotos?: IntakePhoto[];
  /** URL `wo` / `job` when opening the packet panel (for error back link). */
  packetWorkOrderId?: string | null;
  packetJobId?: string | null;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  const selected = floor.selected;

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        routerRef.current.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const stage = useMemo(() => {
    if (!selected) return "work" as FloorStage;
    if (stageProp) return stageProp;
    return deriveDefaultStage(selected);
  }, [selected, stageProp]);

  const docketSelectedKey =
    selected == null
      ? null
      : selected.is_safety && !selected.job_id
        ? `safety-${selected.work_order_id}`
        : selected.is_qc && !selected.job_id
          ? `qc-${selected.work_order_id}`
          : selected.job_id
            ? (docketItems.find(
                (item) =>
                  item.work_order_id === selected.work_order_id &&
                  (item.kind === "now" || item.kind === "assigned")
              )?.key ?? null)
            : null;

  const packetErrorBackHref = useMemo(() => {
    const workOrderId = packetWorkOrderId ?? selected?.work_order_id ?? null;
    if (!workOrderId) return "/technician";
    const jobId = packetJobId ?? selected?.job_id ?? null;
    return closePacketHref(workOrderId, jobId, stageProp ?? stage);
  }, [
    packetWorkOrderId,
    packetJobId,
    selected?.work_order_id,
    selected?.job_id,
    stageProp,
    stage,
  ]);

  return (
    <div className="floor-shell">
      <header className="floor-header">
        <h1 className="floor-title">Tech floor</h1>
      </header>

      <ReadyForPickupCarousel items={readyForPickup} />

      <div className="floor-layout">
        <aside className="floor-queue">
          <div className="floor-lane floor-docket-lane">
            <p className="floor-lane-title">My motorcycles</p>
            <TechnicianDocketList
              items={docketItems}
              selectedKey={docketSelectedKey}
              linkMode="floor"
            />
          </div>
          {floor.priority.length === 0 &&
          floor.needsQc.length === 0 &&
          floor.safeties.length === 0 &&
          floor.flagged.length === 0 &&
          docketItems.length === 0 ? (
            <p className="floor-muted">
              Queue empty — wait for a job assignment from the front office.
            </p>
          ) : null}
        </aside>

        <section className="floor-surface">
          {panel === "packet" && packet ? (
            <JobPacketPanel
              packet={packet}
              section={packetSection}
              closeHref={closePacketHref(
                packet.work_order_id,
                selected?.job_id ?? null,
                stageProp ?? stage
              )}
              photos={packetPhotos}
              selectedJobId={selected?.job_id ?? null}
              stage={stageProp ?? stage}
            />
          ) : panel === "packet" && !packet ? (
            <JobPacketErrorState backHref={packetErrorBackHref} />
          ) : !selected ? (
            <p className="floor-muted floor-surface-empty">
              Select a motorcycle from the docket to begin.
            </p>
          ) : (
            <>
              <div className="floor-surface-scroll">
                <div className="floor-surface-hero">
                  <p className="floor-wo-meta">
                    {selected.work_order_number} · {selected.wo_status_label}
                  </p>
                  <h2 className="floor-bike">{selected.motorcycle_label}</h2>
                  <p className="floor-muted">
                    {[
                      selected.service_name,
                      selected.labour_label,
                      selected.labour_over ? "over estimate" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {selected.flags.length > 0 ? (
                    <div className="floor-flag-banner" role="status">
                      <p className="floor-flag-banner-title">Admin flag open</p>
                      <ul>
                        {selected.flags.map((flag) => (
                          <li key={flag.admin_flag_id}>
                            {flag.reason}
                            {flag.note ? ` — ${flag.note}` : ""}
                          </li>
                        ))}
                      </ul>
                      <Link
                        href={techJobPacketHref(selected.work_order_id, {
                          jobId: selected.job_id ?? undefined,
                          stage,
                        })}
                        className="floor-muted"
                      >
                        View in job packet →
                      </Link>
                    </div>
                  ) : null}
                </div>

                <MotorcycleServices surface={selected} />

                <StageRail surface={selected} stage={stage} />

                {stage === "inspect" ? <InspectStage surface={selected} /> : null}
                {stage === "work" ? <WorkStage surface={selected} /> : null}
                {stage === "proof" ? <ProofStage surface={selected} /> : null}
                {stage === "done" ? <DoneStage surface={selected} stage={stage} /> : null}
                {stage === "qc" ? <QcStage surface={selected} stage={stage} /> : null}
                {stage === "safety" ? <SafetyStage surface={selected} /> : null}
              </div>

              <StickyDock surface={selected} stage={stage} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
