"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { WorkOrderDetail, TechnicianOption } from "@/lib/services/workOrders";
import type { WorkOrderFormState } from "@/app/(app)/work_orders/actions";
import type { QualityFormState } from "@/app/(app)/work_orders/quality-actions";
import { FormError, TextAreaField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { JOB_STATUS_LABELS } from "@/lib/status/labels";
import { formatDateTime } from "@/lib/datetime/format";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

type Action = (
  state: WorkOrderFormState,
  formData: FormData
) => Promise<WorkOrderFormState>;

type QualityAction = (
  state: QualityFormState,
  formData: FormData
) => Promise<QualityFormState>;

function formatDate(value: string | null) {
  if (!value) return null;
  return formatDateTime(value);
}

export function OverviewTab({
  detail,
  technicians,
  canAssign,
  canRunQc,
  canMarkReady,
  canComplete,
  canHoldOrCancel,
  canResumeHold,
  canOverrideComplete,
  canClearFlags = false,
  readOnly,
  assignAction,
  setPrimaryAction,
  qcAction,
  readyAction,
  completeAction,
  cancelAction,
  holdAction,
  resumeAction,
  clearFlagAction,
}: {
  detail: WorkOrderDetail;
  technicians: TechnicianOption[];
  canAssign: boolean;
  canRunQc: boolean;
  canMarkReady: boolean;
  canComplete: boolean;
  canHoldOrCancel: boolean;
  canResumeHold: boolean;
  canOverrideComplete: boolean;
  canClearFlags?: boolean;
  readOnly: boolean;
  assignAction: Action;
  setPrimaryAction: Action;
  qcAction: QualityAction;
  readyAction: QualityAction;
  completeAction: QualityAction;
  cancelAction: QualityAction;
  holdAction: QualityAction;
  resumeAction: QualityAction;
  clearFlagAction?: QualityAction;
}) {
  const [assignState, assignFormAction] = useActionState(assignAction, {
    error: null,
  });
  const [primaryState, primaryFormAction] = useActionState(setPrimaryAction, {
    error: null,
  });
  const [qcState, qcFormAction] = useActionState(qcAction, { error: null });
  const [readyState, readyFormAction] = useActionState(readyAction, {
    error: null,
  });
  const [completeState, completeFormAction] = useActionState(completeAction, {
    error: null,
  });
  const [clearFlagState, clearFlagFormAction] = useActionState(
    clearFlagAction ?? (async () => ({ error: null })),
    { error: null }
  );
  const [cancelState, cancelFormAction] = useActionState(cancelAction, {
    error: null,
  });
  const [holdState, holdFormAction] = useActionState(holdAction, {
    error: null,
  });
  const [resumeState, resumeFormAction] = useActionState(resumeAction, {
    error: null,
  });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmHold, setConfirmHold] = useState(false);

  const assignedIds = new Set(detail.technicians.map((row) => row.technician_id));

  const locked = detail.status === "completed" || detail.status === "cancelled";
  const qcDone = Boolean(detail.quality_checked_at || detail.quality_checked_by_user_id);
  const readyDone = Boolean(
    detail.ready_for_pickup_at || detail.status === "ready_for_pickup"
  );
  const showCompletion =
    !readOnly && !locked && (canRunQc || canMarkReady || canComplete || canHoldOrCancel);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Inspection report</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Visual Motorcycle Inspection Report — required before finishing jobs.
            </p>
          </div>
          <Link
            href={`/work_orders/${detail.work_order_id}/inspection`}
            className="btn btn-primary min-h-12"
          >
            Open inspection report
          </Link>
        </div>
      </section>

      <section className="rounded border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Internal notes</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
          {detail.internal_notes?.trim() || "No internal notes."}
        </p>
      </section>

      <section className="rounded border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Assigned technicians</h2>
        {detail.technicians.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">No technicians assigned yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {detail.technicians.map((row) => (
              <li key={row.technician_id} className="py-2 text-sm text-zinc-800">
                {row.technician
                  ? `${row.technician.first_name} ${row.technician.last_name}`
                  : row.technician_id}
                {detail.primary_technician_id === row.technician_id ? (
                  <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                    Primary
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canAssign && !readOnly && !locked ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            action={assignFormAction}
            className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4"
          >
            <h3 className="font-semibold text-zinc-900">Assign technician</h3>
            <FormError message={assignState.error} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                Technician
              </span>
              <select
                className={SELECT_CLASS}
                name="technician_id"
                required
                defaultValue=""
              >
                <option value="">Select technician</option>
                {technicians
                  .filter((tech) => !assignedIds.has(tech.user_id))
                  .map((tech) => (
                    <option key={tech.user_id} value={tech.user_id}>
                      {tech.first_name} {tech.last_name}
                    </option>
                  ))}
              </select>
            </label>
            <div>
              <SubmitButton label="Assign" pendingLabel="Assigning…" />
            </div>
          </form>

          <form
            action={primaryFormAction}
            className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4"
          >
            <h3 className="font-semibold text-zinc-900">Set primary technician</h3>
            <FormError message={primaryState.error} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                Primary technician
              </span>
              <select
                className={SELECT_CLASS}
                name="technician_id"
                defaultValue={detail.primary_technician_id ?? ""}
              >
                <option value="">Unassigned</option>
                {technicians.map((tech) => (
                  <option key={tech.user_id} value={tech.user_id}>
                    {tech.first_name} {tech.last_name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <SubmitButton label="Save primary" pendingLabel="Saving…" />
            </div>
          </form>
        </div>
      ) : null}

      <section className="rounded border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Jobs summary</h2>
        {detail.jobs.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">No jobs on this work order yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {detail.jobs.map((job) => (
              <li
                key={job.job_id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="font-medium text-zinc-900">
                  {job.service_name_snapshot}
                </span>
                <span className="text-zinc-600">
                  {JOB_STATUS_LABELS[job.status] ?? job.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-zinc-900">Completion</h2>
        {detail.open_admin_flags.length > 0 ? (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-3">
            <h3 className="text-sm font-semibold text-red-900">Admin flags</h3>
            <ul className="mt-2 space-y-2">
              {detail.open_admin_flags.map((flag) => (
                <li
                  key={flag.admin_flag_id}
                  className="flex flex-wrap items-start justify-between gap-2 text-sm"
                >
                  <div>
                    <span className="font-medium capitalize">{flag.reason}</span>
                    {flag.note ? (
                      <span className="text-zinc-700"> — {flag.note}</span>
                    ) : null}
                  </div>
                  {canClearFlags ? (
                    <form action={clearFlagFormAction}>
                      <input
                        type="hidden"
                        name="admin_flag_id"
                        value={flag.admin_flag_id}
                      />
                      <button type="submit" className="btn btn-secondary text-xs">
                        Clear
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
            <FormError message={clearFlagState.error} />
          </div>
        ) : null}
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Quality check</dt>
            <dd className="font-medium text-zinc-900">
              {formatDate(detail.quality_checked_at) ?? "Not completed"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">QC assignee</dt>
            <dd className="font-medium text-zinc-900">
              {detail.quality_check_assignee
                ? `${detail.quality_check_assignee.first_name} ${detail.quality_check_assignee.last_name}`
                : detail.status === "quality_check"
                  ? "Unassigned (no eligible peer clocked in)"
                  : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Ready for pickup</dt>
            <dd className="font-medium text-zinc-900">
              {formatDate(detail.ready_for_pickup_at) ?? "Not marked"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Completed</dt>
            <dd className="font-medium text-zinc-900">
              {formatDate(detail.completed_at) ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Pickup notes</dt>
            <dd className="font-medium text-zinc-900">
              {detail.pickup_notes?.trim() || "—"}
            </dd>
          </div>
        </dl>
        {detail.quality_check_notes?.trim() ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">
            QC notes: {detail.quality_check_notes}
          </p>
        ) : null}

        {showCompletion ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {canRunQc && !qcDone ? (
              <form
                action={qcFormAction}
                className="flex flex-col gap-3 rounded border border-zinc-200 p-4"
              >
                <h3 className="font-semibold text-zinc-900">Quality check</h3>
                <p className="text-sm text-zinc-600">
                  Requires all active jobs completed.
                </p>
                <FormError message={qcState.error} />
                <TextAreaField
                  label="QC notes (optional)"
                  name="quality_check_notes"
                  rows={2}
                />
                <div>
                  <SubmitButton label="Complete quality check" pendingLabel="Saving…" />
                </div>
              </form>
            ) : null}

            {canMarkReady && qcDone && !readyDone ? (
              <form
                action={readyFormAction}
                className="flex flex-col gap-3 rounded border border-zinc-200 p-4"
              >
                <h3 className="font-semibold text-zinc-900">Ready for pickup</h3>
                <p className="text-sm text-zinc-600">
                  Requires QC and all active jobs completed.
                </p>
                <FormError message={readyState.error} />
                <div>
                  <SubmitButton label="Mark ready for pickup" pendingLabel="Saving…" />
                </div>
              </form>
            ) : null}

            {canComplete && (readyDone || canOverrideComplete) ? (
              <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4">
                <h3 className="font-semibold text-zinc-900">Complete / release</h3>
                {!readyDone && canOverrideComplete ? (
                  <p className="text-sm text-amber-800">
                    Not marked ready for pickup — owner/manager override allowed.
                  </p>
                ) : null}
                <FormError message={completeState.error} />
                {confirmComplete ? (
                  <form action={completeFormAction} className="flex flex-col gap-3">
                    <TextAreaField
                      label="Pickup notes (optional)"
                      name="pickup_notes"
                      rows={2}
                    />
                    <p className="text-sm text-zinc-700">
                      Confirm release to the customer? This completes the work order.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton label="Confirm complete" pendingLabel="Completing…" />
                      <button
                        type="button"
                        className="min-h-11 rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                        onClick={() => setConfirmComplete(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="min-h-11 self-start rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
                    onClick={() => setConfirmComplete(true)}
                  >
                    Complete work order
                  </button>
                )}
              </div>
            ) : null}

            {canHoldOrCancel ? (
              <div className="flex flex-col gap-4 rounded border border-zinc-200 p-4 lg:col-span-2">
                <h3 className="font-semibold text-zinc-900">Hold / cancel</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    {detail.status === "on_hold" && canResumeHold ? (
                      <div className="flex flex-col gap-3">
                        <FormError message={resumeState.error} />
                        <p className="text-sm text-zinc-600">
                          This work order is on hold. Resuming returns it to the active
                          flow.
                        </p>
                        <form action={resumeFormAction}>
                          <SubmitButton
                            label="Resume from hold"
                            pendingLabel="Resuming…"
                          />
                        </form>
                      </div>
                    ) : (
                      <>
                        <FormError message={holdState.error} />
                        {confirmHold ? (
                          <form action={holdFormAction} className="flex flex-col gap-3">
                            <TextAreaField
                              label="Hold reason (optional)"
                              name="hold_reason"
                              rows={2}
                            />
                            <div className="flex flex-wrap gap-2">
                              <SubmitButton
                                label="Confirm on hold"
                                pendingLabel="Saving…"
                              />
                              <button
                                type="button"
                                className="min-h-11 rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                                onClick={() => setConfirmHold(false)}
                              >
                                Back
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className="min-h-11 rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                            onClick={() => setConfirmHold(true)}
                          >
                            Place on hold
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <FormError message={cancelState.error} />
                    {confirmCancel ? (
                      <form action={cancelFormAction} className="flex flex-col gap-3">
                        <TextAreaField
                          label="Cancel reason"
                          name="cancel_reason"
                          rows={2}
                        />
                        <p className="text-sm text-red-800">
                          Cancelling is permanent for this work order status.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <SubmitButton
                            label="Confirm cancel"
                            pendingLabel="Cancelling…"
                          />
                          <button
                            type="button"
                            className="min-h-11 rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                            onClick={() => setConfirmCancel(false)}
                          >
                            Back
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="min-h-11 rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50"
                        onClick={() => setConfirmCancel(true)}
                      >
                        Cancel work order
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
