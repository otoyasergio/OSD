"use client";

import { useActionState, useState } from "react";
import type { WorkOrderJob, TechnicianOption } from "@/lib/services/workOrders";
import type { JobFormState } from "@/app/(app)/work_orders/job-actions";
import { JOB_STATUS_LABELS } from "@/lib/status/labels";
import type { JobStatus } from "@/lib/database/types";
import { APPROVAL_METHOD_OPTIONS } from "@/components/jobs/JobActions";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { formatLabourComparison } from "@/lib/services/labour";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

type Action = (
  state: JobFormState,
  formData: FormData
) => Promise<JobFormState>;

function StatusButton({
  action,
  status,
  label,
}: {
  action: Action;
  status: JobStatus;
  label: string;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className="min-h-11 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
      >
        {label}
      </button>
      <FormError message={state.error} />
    </form>
  );
}

export function JobCard({
  job,
  technicians,
  readOnly,
  canApprove,
  canEdit,
  canComplete,
  isTechnicianSelf,
  assignAction,
  statusAction,
  approveAction,
  declineAction,
  cancelAction,
}: {
  job: WorkOrderJob;
  technicians: TechnicianOption[];
  readOnly: boolean;
  canApprove: boolean;
  canEdit: boolean;
  canComplete: boolean;
  isTechnicianSelf: boolean;
  assignAction: Action;
  statusAction: Action;
  approveAction: Action;
  declineAction: Action;
  cancelAction: Action;
}) {
  const [showDecline, setShowDecline] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [assignState, assignFormAction] = useActionState(assignAction, {
    error: null,
  });
  const [approveState, approveFormAction] = useActionState(approveAction, {
    error: null,
  });
  const [declineState, declineFormAction] = useActionState(declineAction, {
    error: null,
  });
  const [cancelState, cancelFormAction] = useActionState(cancelAction, {
    error: null,
  });

  const awaitingApproval =
    job.status === "waiting_for_approval" ||
    job.status === "draft" ||
    job.status === "declined";

  const canStart =
    (canComplete || isTechnicianSelf) &&
    (job.status === "approved" || job.status === "ready_to_start");

  const canMarkComplete =
    (canComplete || isTechnicianSelf) &&
    Boolean(job.assigned_technician_id) &&
    (job.status === "in_progress" ||
      job.status === "approved" ||
      job.status === "ready_to_start");

  const labour = formatLabourComparison(
    job.estimated_labour_snapshot,
    job.started_at,
    job.completed_at
  );

  return (
    <article className="rounded border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">
            {job.service_name_snapshot}
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            {JOB_STATUS_LABELS[job.status] ?? job.status}
            {job.assigned_technician
              ? ` · ${job.assigned_technician.first_name} ${job.assigned_technician.last_name}`
              : " · Unassigned"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {job.standard_price_snapshot != null
              ? `$${job.standard_price_snapshot}`
              : "No price"}
            {!labour && job.estimated_labour_snapshot != null
              ? ` · ${job.estimated_labour_snapshot} h`
              : ""}
          </p>
          {labour ? (
            <p
              className={`mt-1 text-sm ${
                labour.overEstimate
                  ? "font-medium text-amber-700"
                  : "text-zinc-500"
              }`}
            >
              {labour.label}
            </p>
          ) : null}
        </div>
      </div>

      {job.decline_reason ? (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Declined: {job.decline_reason}
        </p>
      ) : null}

      {!readOnly ? (
        <div className="mt-4 flex flex-col gap-4">
          {canEdit ? (
            <form
              action={assignFormAction}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="min-w-[12rem] flex-1">
                <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                  Assign technician
                </span>
                <select
                  className={SELECT_CLASS}
                  name="technician_id"
                  required
                  defaultValue={job.assigned_technician_id ?? ""}
                >
                  <option value="">Select technician</option>
                  {technicians.map((tech) => (
                    <option key={tech.user_id} value={tech.user_id}>
                      {tech.first_name} {tech.last_name}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton label="Assign" pendingLabel="Assigning…" />
              <FormError message={assignState.error} />
            </form>
          ) : null}

          {canApprove && awaitingApproval ? (
            <form
              action={approveFormAction}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="min-w-[12rem] flex-1">
                <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                  Approval method
                </span>
                <select
                  className={SELECT_CLASS}
                  name="approval_method"
                  required
                  defaultValue="in_person"
                >
                  {APPROVAL_METHOD_OPTIONS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton label="Record approval" pendingLabel="Saving…" />
              <FormError message={approveState.error} />
            </form>
          ) : null}

          {canApprove &&
          (job.status === "waiting_for_approval" ||
            job.status === "draft" ||
            job.status === "approved") ? (
            <div>
              {!showDecline ? (
                <button
                  type="button"
                  onClick={() => setShowDecline(true)}
                  className="min-h-11 rounded border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50"
                >
                  Record decline…
                </button>
              ) : (
                <form action={declineFormAction} className="flex flex-col gap-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                      Decline reason <span className="text-red-600">*</span>
                    </span>
                    <textarea
                      className={`${SELECT_CLASS} min-h-24`}
                      name="decline_reason"
                      required
                      rows={3}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton
                      label="Confirm decline"
                      pendingLabel="Saving…"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDecline(false)}
                      className="min-h-11 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                  <FormError message={declineState.error} />
                </form>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {canStart ? (
              <StatusButton
                action={statusAction}
                status="in_progress"
                label="Start job"
              />
            ) : null}
            {canMarkComplete ? (
              <StatusButton
                action={statusAction}
                status="completed"
                label="Complete job"
              />
            ) : null}
            {canEdit && job.status === "approved" ? (
              <StatusButton
                action={statusAction}
                status="ready_to_start"
                label="Mark ready"
              />
            ) : null}
            {canEdit && job.status !== "cancelled" && job.status !== "completed" ? (
              !showCancel ? (
                <button
                  type="button"
                  onClick={() => setShowCancel(true)}
                  className="min-h-11 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
                >
                  Cancel job…
                </button>
              ) : (
                <form action={cancelFormAction} className="w-full flex flex-col gap-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                      Cancel note <span className="text-red-600">*</span>
                    </span>
                    <textarea
                      className={`${SELECT_CLASS} min-h-24`}
                      name="note"
                      required
                      rows={2}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton label="Confirm cancel" pendingLabel="Saving…" />
                    <button
                      type="button"
                      onClick={() => setShowCancel(false)}
                      className="min-h-11 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
                    >
                      Back
                    </button>
                  </div>
                  <FormError message={cancelState.error} />
                </form>
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
