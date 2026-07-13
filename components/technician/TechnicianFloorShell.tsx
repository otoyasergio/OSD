"use client";

import Link from "next/link";
import { useActionState } from "react";
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

function hrefForItem(item: FloorQueueItem, mode?: string): string {
  const params = new URLSearchParams();
  if (item.job_id) params.set("job", item.job_id);
  params.set("wo", item.work_order_id);
  if (item.kind === "qc") params.set("mode", "qc");
  else if (mode) params.set("mode", mode);
  return `/technician?${params.toString()}`;
}

function QueueLane({
  title,
  items,
  selectedKey,
}: {
  title: string;
  items: FloorQueueItem[];
  selectedKey: string | null;
}) {
  if (items.length === 0) {
    return (
      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
          {title}
        </p>
        <p className="text-xs text-[var(--status-neutral)]">None</p>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((item) => {
          const selected = item.key === selectedKey;
          return (
            <li key={item.key}>
              <Link
                href={hrefForItem(item)}
                className={`block rounded-lg border px-3 py-2 text-sm transition ${
                  selected
                    ? "border-foreground bg-foreground text-background"
                    : item.lane === "flagged"
                      ? "border-[var(--status-danger)]/40 bg-[var(--status-danger-bg)]"
                      : item.lane === "needs_qc"
                        ? "border-amber-500/50 bg-amber-50"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-foreground/40"
                }`}
              >
                <div className="font-medium leading-snug">{item.title}</div>
                <div
                  className={`mt-0.5 text-xs ${selected ? "opacity-80" : "text-[var(--status-neutral)]"}`}
                >
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

function ActionMessage({ state }: { state: FloorActionState }) {
  if (!state?.error && !state?.success) return null;
  return (
    <p
      className={`mt-2 text-sm ${state.error ? "text-[var(--status-danger-fg)]" : "text-[var(--status-success-fg)]"}`}
      role="status"
    >
      {state.error ?? state.success}
    </p>
  );
}

function ModeTabs({ surface }: { surface: FloorOsSurface }) {
  const modes = [
    ["job", "Job"],
    ["inspection", "Inspection"],
    ["parts", "Parts"],
    ["qc", "QC"],
    ["notes", "Notes"],
  ] as const;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {modes.map(([id, label]) => {
        const params = new URLSearchParams();
        if (surface.job_id) params.set("job", surface.job_id);
        params.set("wo", surface.work_order_id);
        params.set("mode", id);
        const active = surface.mode === id;
        return (
          <Link
            key={id}
            href={`/technician?${params.toString()}`}
            className={`rounded-md px-3 py-1.5 text-sm ${
              active
                ? "bg-foreground text-background"
                : "bg-[var(--surface-muted)] text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function JobMode({ surface }: { surface: FloorOsSurface }) {
  const [startState, startAction, startPending] = useActionState(
    startJobFloorAction,
    null
  );
  const [completeState, completeAction, completePending] = useActionState(
    completeJobFloorAction,
    null
  );
  const [checkState, checkAction] = useActionState(toggleChecklistAction, null);
  const [proofState, proofAction, proofPending] = useActionState(
    uploadJobProofAction,
    null
  );
  const [exceptionState, exceptionAction] = useActionState(addProofExceptionAction, null);
  const [flagState, flagAction, flagPending] = useActionState(flagForAdminAction, null);
  const [pullState, pullAction, pullPending] = useActionState(pullJobAction, null);

  if (surface.can_pull && surface.job_id) {
    return (
      <div>
        <p className="text-sm text-[var(--status-neutral)]">
          Pull this ready job into your priority queue.
        </p>
        <form action={pullAction} className="mt-3">
          <input type="hidden" name="job_id" value={surface.job_id} />
          <input type="hidden" name="work_order_id" value={surface.work_order_id} />
          <button className="btn btn-primary" disabled={pullPending}>
            {pullPending ? "Pulling…" : "Pull job"}
          </button>
          <ActionMessage state={pullState} />
        </form>
      </div>
    );
  }

  if (!surface.job_id) {
    return (
      <p className="text-sm text-[var(--status-neutral)]">
        Select a job from your queue.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{surface.service_name}</h3>
        <p className="text-sm text-[var(--status-neutral)]">
          {surface.job_status_label}
          {surface.labour_label ? ` · ${surface.labour_label}` : ""}
          {surface.labour_over ? " · over estimate" : ""}
        </p>
        {!surface.inspection_complete ? (
          <p className="mt-1 text-sm text-[var(--status-warning-fg)]">
            Inspection must be complete before finishing this job.{" "}
            <Link href={surface.inspection_href} className="underline">
              Open inspection
            </Link>
          </p>
        ) : null}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Standard work</h4>
        <ul className="space-y-2">
          {surface.checklist.map((item) => (
            <li key={item.job_checklist_item_id}>
              <form action={checkAction} className="flex items-start gap-2">
                <input type="hidden" name="item_id" value={item.job_checklist_item_id} />
                <input type="hidden" name="work_order_id" value={surface.work_order_id} />
                <input
                  type="hidden"
                  name="checked"
                  value={item.checked_at ? "false" : "true"}
                />
                <button
                  type="submit"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    item.checked_at
                      ? "border-foreground bg-foreground text-background"
                      : "border-[var(--border)]"
                  }`}
                  aria-pressed={Boolean(item.checked_at)}
                >
                  {item.checked_at ? "✓" : ""}
                </button>
                <span className="text-sm">{item.title}</span>
              </form>
            </li>
          ))}
        </ul>
        <ActionMessage state={checkState} />
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Proof</h4>
        <p className="mb-2 text-xs text-[var(--status-neutral)]">
          {surface.proof_count > 0
            ? `${surface.proof_count} after photo(s)`
            : surface.has_proof_exception
              ? "Proof exception on file"
              : "Need after photo or exception note"}
        </p>
        <form action={proofAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="job_id" value={surface.job_id} />
          <input type="hidden" name="work_order_id" value={surface.work_order_id} />
          <input
            type="file"
            name="file"
            accept="image/*"
            capture="environment"
            className="text-sm"
            required
          />
          <button className="btn btn-secondary" disabled={proofPending}>
            {proofPending ? "Uploading…" : "Upload proof"}
          </button>
        </form>
        <ActionMessage state={proofState} />
        <form action={exceptionAction} className="mt-2 space-y-2">
          <input type="hidden" name="job_id" value={surface.job_id} />
          <input type="hidden" name="work_order_id" value={surface.work_order_id} />
          <textarea
            name="note"
            required
            rows={2}
            placeholder="Proof exception (why no after photo)"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <button className="btn btn-secondary" type="submit">
            Save exception
          </button>
          <ActionMessage state={exceptionState} />
        </form>
      </div>

      <div className="flex flex-wrap gap-2">
        {surface.can_start ? (
          <form action={startAction}>
            <input type="hidden" name="job_id" value={surface.job_id} />
            <input type="hidden" name="work_order_id" value={surface.work_order_id} />
            <button className="btn btn-primary" disabled={startPending}>
              {startPending ? "Starting…" : "Start job"}
            </button>
          </form>
        ) : null}
        {surface.can_complete ? (
          <form action={completeAction}>
            <input type="hidden" name="job_id" value={surface.job_id} />
            <input type="hidden" name="work_order_id" value={surface.work_order_id} />
            <button
              className="btn btn-primary"
              disabled={completePending || !surface.complete_gate_ok}
              title={surface.complete_gate_reason ?? undefined}
            >
              {completePending ? "Completing…" : "Complete job"}
            </button>
          </form>
        ) : null}
      </div>
      {!surface.complete_gate_ok && surface.can_complete ? (
        <p className="text-sm text-[var(--status-warning-fg)]">
          {surface.complete_gate_reason}
        </p>
      ) : null}
      <ActionMessage state={startState} />
      <ActionMessage state={completeState} />

      <details className="rounded-lg border border-[var(--border)] p-3">
        <summary className="cursor-pointer text-sm font-semibold">Flag for admin</summary>
        <form action={flagAction} className="mt-3 space-y-2">
          <input type="hidden" name="job_id" value={surface.job_id} />
          <input type="hidden" name="work_order_id" value={surface.work_order_id} />
          <select
            name="reason"
            required
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            defaultValue="parts"
          >
            <option value="parts">Parts</option>
            <option value="approval">Approval</option>
            <option value="tool">Tool</option>
            <option value="quality">Quality</option>
            <option value="other">Other</option>
          </select>
          <textarea
            name="note"
            rows={2}
            placeholder="Optional note"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <button className="btn btn-secondary" disabled={flagPending}>
            {flagPending ? "Flagging…" : "Raise flag"}
          </button>
          <ActionMessage state={flagState} />
        </form>
      </details>
    </div>
  );
}

function PartsMode({ surface }: { surface: FloorOsSurface }) {
  const [state, action, pending] = useActionState(installPartFloorAction, null);
  if (!surface.job_id) {
    return <p className="text-sm text-[var(--status-neutral)]">Select a job first.</p>;
  }
  if (surface.parts.length === 0) {
    return (
      <p className="text-sm text-[var(--status-neutral)]">
        No parts on this job. Flag admin if you are waiting on parts.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {surface.parts.map((part) => (
        <li
          key={part.part_id}
          className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
        >
          <div>
            <div className="text-sm font-medium">{part.name}</div>
            <div className="text-xs text-[var(--status-neutral)]">{part.status}</div>
          </div>
          {part.can_install ? (
            <form action={action}>
              <input type="hidden" name="part_id" value={part.part_id} />
              <input type="hidden" name="work_order_id" value={surface.work_order_id} />
              <button className="btn btn-secondary" disabled={pending}>
                Install
              </button>
            </form>
          ) : null}
        </li>
      ))}
      <ActionMessage state={state} />
    </ul>
  );
}

function QcMode({ surface }: { surface: FloorOsSurface }) {
  const [passState, passAction, passPending] = useActionState(passPeerQcAction, null);
  const [failState, failAction, failPending] = useActionState(failPeerQcAction, null);

  if (!surface.is_qc) {
    return (
      <p className="text-sm text-[var(--status-neutral)]">
        No peer QC assigned on this work order yet.
      </p>
    );
  }

  if (!surface.qc_assignee_is_me) {
    return (
      <p className="text-sm text-[var(--status-neutral)]">
        This QC is assigned to another technician.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Confirm the work on {surface.motorcycle_label} meets shop standard, then pass or
        fail.
      </p>
      <form action={passAction} className="space-y-2">
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <textarea
          name="notes"
          rows={2}
          placeholder="Optional pass notes"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <button className="btn btn-primary" disabled={passPending}>
          {passPending ? "Passing…" : "Pass QC"}
        </button>
        <ActionMessage state={passState} />
      </form>
      <form action={failAction} className="space-y-2">
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <textarea
          name="reason"
          required
          rows={2}
          placeholder="Fail reason (required)"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <button className="btn btn-secondary" disabled={failPending}>
          {failPending ? "Failing…" : "Fail QC"}
        </button>
        <ActionMessage state={failState} />
      </form>
    </div>
  );
}

export function TechnicianFloorShell({
  floor,
  openClock,
}: {
  floor: TechnicianFloorOs;
  openClock: TimeClockEntry | null;
}) {
  const selected = floor.selected;
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
    <div className="page-stack">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tech floor</h1>
          <p className="text-sm text-[var(--status-neutral)]">
            Queue + focused work surface — one job at a time.
          </p>
        </div>
        <div className="min-w-[220px]">
          <TimeClockWidget openEntry={openClock} />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:w-[34%]">
          <QueueLane
            title="Priority (assigned)"
            items={floor.priority}
            selectedKey={selectedKey}
          />
          <QueueLane
            title="Ready to pull"
            items={floor.readyToPull}
            selectedKey={selectedKey}
          />
          <QueueLane
            title="Needs QC (you)"
            items={floor.needsQc}
            selectedKey={selectedKey}
          />
          <QueueLane title="Flagged" items={floor.flagged} selectedKey={selectedKey} />
        </aside>

        <section className="min-h-[320px] flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {!selected ? (
            <p className="text-sm text-[var(--status-neutral)]">
              Nothing in your queue. Pull a ready job or wait for an assignment.
            </p>
          ) : (
            <>
              <div className="mb-3">
                <p className="text-xs uppercase tracking-wide text-[var(--status-neutral)]">
                  {selected.work_order_number} · {selected.wo_status_label}
                </p>
                <h2 className="text-xl font-semibold">{selected.motorcycle_label}</h2>
                <p className="text-sm text-[var(--status-neutral)]">
                  {selected.customer_label}
                </p>
              </div>
              <ModeTabs surface={selected} />
              {selected.mode === "job" ? <JobMode surface={selected} /> : null}
              {selected.mode === "inspection" ? (
                <div className="space-y-3">
                  <p className="text-sm">
                    {selected.inspection_complete
                      ? "Inspection is complete."
                      : "Open the fullscreen inspection checklist on iPad."}
                  </p>
                  <Link href={selected.inspection_href} className="btn btn-primary">
                    {selected.inspection_complete ? "View inspection" : "Open inspection"}
                  </Link>
                </div>
              ) : null}
              {selected.mode === "parts" ? <PartsMode surface={selected} /> : null}
              {selected.mode === "qc" ? <QcMode surface={selected} /> : null}
              {selected.mode === "notes" ? (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--status-neutral)]">
                    Use the work order notes tab for full history, or raise an admin flag
                    from Job mode.
                  </p>
                  <Link
                    href={`${selected.overview_href}?tab=notes`}
                    className="btn btn-secondary"
                  >
                    Open notes
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
