"use client";

import Link from "next/link";
import { useActionState, useMemo, type ReactNode } from "react";
import type {
  FloorOsSurface,
  FloorQueueItem,
  TechnicianFloorOs,
} from "@/lib/services/technicianFloor";
import { TimeClockWidget } from "@/components/technician/TimeClockWidget";
import type { TimeClockEntry } from "@/lib/services/timeClock";
import {
  addProofExceptionAction,
  completeJobFloorAction,
  failPeerQcAction,
  flagForAdminAction,
  installPartFloorAction,
  passPeerQcAction,
  pullJobAction,
  startJobFloorAction,
  toggleChecklistAction,
  uploadJobProofAction,
  type FloorActionState,
} from "@/app/(app)/technician/floor-actions";

export type FloorStage = "inspect" | "work" | "proof" | "done" | "qc";

export function deriveDefaultStage(surface: FloorOsSurface): FloorStage {
  if (surface.is_qc && surface.qc_assignee_is_me && !surface.job_id) return "qc";
  if (surface.can_pull) return "work";
  if (!surface.inspection_complete) return "inspect";
  const checklistOpen = surface.checklist.some((item) => !item.checked_at);
  const partsOpen = surface.parts.some((part) => part.can_install);
  if (checklistOpen || partsOpen) return "work";
  if (surface.proof_count < 1 && !surface.has_proof_exception) return "proof";
  return "done";
}

function hrefForItem(item: FloorQueueItem, stage?: FloorStage): string {
  const params = new URLSearchParams();
  if (item.job_id) params.set("job", item.job_id);
  params.set("wo", item.work_order_id);
  if (item.kind === "qc") params.set("stage", "qc");
  else if (stage) params.set("stage", stage);
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

function QueueLane({
  title,
  items,
  selectedKey,
  nowJobId,
}: {
  title: string;
  items: FloorQueueItem[];
  selectedKey: string | null;
  nowJobId?: string | null;
}) {
  if (items.length === 0) return null;

  return (
    <div className="floor-lane">
      <p className="floor-lane-title">{title}</p>
      <ul className="floor-lane-list">
        {items.map((item) => {
          const selected = item.key === selectedKey;
          const isNow = Boolean(nowJobId && item.job_id === nowJobId);
          return (
            <li key={item.key}>
              <Link
                href={hrefForItem(item)}
                className={[
                  "floor-queue-card",
                  selected ? "floor-queue-card--selected" : "",
                  isNow && !selected ? "floor-queue-card--now" : "",
                  item.lane === "flagged" ? "floor-queue-card--flagged" : "",
                  item.lane === "needs_qc" ? "floor-queue-card--qc" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {isNow ? <span className="floor-now-badge">NOW</span> : null}
                <div className="floor-queue-card-title">{item.title}</div>
                <div className="floor-queue-card-meta">
                  {item.subtitle} · {item.status_label}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StageRail({ surface, stage }: { surface: FloorOsSurface; stage: FloorStage }) {
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

function DoneStage({ surface }: { surface: FloorOsSurface }) {
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
        href={`${surface.overview_href}?tab=notes`}
        className="btn btn-secondary floor-tap floor-tap--wide"
      >
        Open notes
      </Link>
    </div>
  );
}

function QcStage({ surface }: { surface: FloorOsSurface }) {
  const [failState, failAction, failPending] = useActionState(failPeerQcAction, null);

  if (!surface.is_qc) {
    return <p className="floor-muted">No peer QC on this work order yet.</p>;
  }
  if (!surface.qc_assignee_is_me) {
    return <p className="floor-muted">This QC is assigned to another technician.</p>;
  }

  return (
    <div className="floor-stage-body">
      <p className="floor-lead">
        Confirm {surface.motorcycle_label} meets shop standard, then pass or fail.
      </p>
      <form action={failAction} className="floor-qc-fail">
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <textarea
          name="reason"
          required
          rows={2}
          placeholder="Fail reason (required)"
          className="input"
        />
        <button className="btn btn-secondary floor-tap" disabled={failPending}>
          {failPending ? "Failing…" : "Fail QC"}
        </button>
        <ActionMessage state={failState} />
      </form>
      <p className="floor-muted">Pass QC from the dock below.</p>
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
  const [pullState, pullAction, pullPending] = useActionState(pullJobAction, null);
  const [flagState, flagAction, flagPending] = useActionState(flagForAdminAction, null);
  const [passState, passAction, passPending] = useActionState(passPeerQcAction, null);

  const showFlag = Boolean(surface.job_id) && !surface.can_pull && stage !== "qc";

  let primary: ReactNode = null;
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
  } else if (stage === "qc" && surface.qc_assignee_is_me) {
    primary = (
      <form action={passAction} className="floor-dock-primary">
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <input type="hidden" name="notes" value="" />
        <button className="btn btn-primary floor-dock-btn" disabled={passPending}>
          {passPending ? "Passing…" : "Pass QC"}
        </button>
        <ActionMessage state={passState} />
      </form>
    );
  } else if (surface.can_start && surface.job_id) {
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
  } else if (surface.can_complete && surface.job_id) {
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

  if (!primary && !showFlag) return null;

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
        {primary}
      </div>
    </div>
  );
}

export function TechnicianFloorShell({
  floor,
  openClock,
  stage: stageProp,
}: {
  floor: TechnicianFloorOs;
  openClock: TimeClockEntry | null;
  stage?: FloorStage | null;
}) {
  const selected = floor.selected;
  const nowJobId = floor.priority.find((item) => item.is_active)?.job_id ?? null;

  const stage = useMemo(() => {
    if (!selected) return "work" as FloorStage;
    if (stageProp) return stageProp;
    return deriveDefaultStage(selected);
  }, [selected, stageProp]);

  const selectedKey =
    selected == null
      ? null
      : selected.is_qc && !selected.job_id
        ? `qc-${selected.work_order_id}`
        : selected.job_id
          ? (floor.priority.find((i) => i.job_id === selected.job_id)?.key ??
            floor.readyToPull.find((i) => i.job_id === selected.job_id)?.key ??
            `job-${selected.job_id}`)
          : null;

  return (
    <div className="floor-shell">
      <header className="floor-header">
        <h1 className="floor-title">Tech floor</h1>
        <div className="floor-clock">
          <TimeClockWidget openEntry={openClock} />
        </div>
      </header>

      <div className="floor-layout">
        <aside className="floor-queue">
          <QueueLane
            title="Priority"
            items={floor.priority}
            selectedKey={selectedKey}
            nowJobId={nowJobId}
          />
          <QueueLane
            title="Ready to pull"
            items={floor.readyToPull}
            selectedKey={selectedKey}
          />
          <QueueLane title="Needs QC" items={floor.needsQc} selectedKey={selectedKey} />
          <QueueLane title="Flagged" items={floor.flagged} selectedKey={selectedKey} />
          {floor.priority.length === 0 &&
          floor.readyToPull.length === 0 &&
          floor.needsQc.length === 0 &&
          floor.flagged.length === 0 ? (
            <p className="floor-muted">
              Queue empty — wait for assignment or pull ready work.
            </p>
          ) : null}
        </aside>

        <section className="floor-surface">
          {!selected ? (
            <p className="floor-muted floor-surface-empty">
              Select a job from the queue to begin.
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
                    {selected.service_name
                      ? `${selected.service_name} · ${selected.customer_label}`
                      : selected.customer_label}
                    {selected.labour_label ? ` · ${selected.labour_label}` : ""}
                    {selected.labour_over ? " · over estimate" : ""}
                  </p>
                </div>

                <StageRail surface={selected} stage={stage} />

                {stage === "inspect" ? <InspectStage surface={selected} /> : null}
                {stage === "work" ? <WorkStage surface={selected} /> : null}
                {stage === "proof" ? <ProofStage surface={selected} /> : null}
                {stage === "done" ? <DoneStage surface={selected} /> : null}
                {stage === "qc" ? <QcStage surface={selected} /> : null}
              </div>

              <StickyDock surface={selected} stage={stage} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
