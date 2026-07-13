"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { WorkOrderJob, TechnicianOption } from "@/lib/services/workOrders";
import type { JobFormState } from "@/app/(app)/work_orders/job-actions";
import type { JobStatus } from "@/lib/database/types";
import { APPROVAL_METHOD_OPTIONS } from "@/components/jobs/JobActions";
import { FormError, SELECT_CLASS } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { StageChip } from "@/components/ui/StageChip";
import { formatLabourComparison } from "@/lib/services/labour";
import { JOB_STATUS_LABELS } from "@/lib/status/labels";

function jobStageTone(status: JobStatus): "teal" | "orange" | "muted" | "danger" {
  if (status === "in_progress") return "orange";
  if (status === "completed" || status === "cancelled" || status === "declined")
    return "muted";
  if (status === "waiting_for_approval" || status === "waiting_for_parts")
    return "orange";
  if (status === "approved" || status === "ready_to_start") return "teal";
  return "muted";
}

type Action = (state: JobFormState, formData: FormData) => Promise<JobFormState>;

function StatusButton({
  action,
  status,
  label,
  variant = "secondary",
}: {
  action: Action;
  status: JobStatus;
  label: string;
  variant?: "primary" | "accent" | "secondary";
}) {
  const [state, formAction] = useActionState(action, { error: null });
  const btnClass =
    variant === "accent"
      ? "btn btn-accent"
      : variant === "primary"
        ? "btn btn-primary"
        : "btn btn-secondary";

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={btnClass}>
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
  inspectionComplete,
  inspectionHref,
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
  inspectionComplete?: boolean;
  inspectionHref?: string;
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

  const inspectionBlocksComplete = inspectionComplete === false;
  const canMarkComplete =
    (canComplete || isTechnicianSelf) &&
    Boolean(job.assigned_technician_id) &&
    !inspectionBlocksComplete &&
    job.status === "in_progress";

  const labour = formatLabourComparison(
    job.estimated_labour_snapshot,
    job.started_at,
    job.completed_at
  );

  return (
    <article className="card card-body">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            {job.service_name_snapshot}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StageChip
              label={JOB_STATUS_LABELS[job.status] ?? job.status}
              tone={jobStageTone(job.status)}
            />
            <span className="text-sm text-[var(--status-neutral)]">
              {job.assigned_technician
                ? `${job.assigned_technician.first_name} ${job.assigned_technician.last_name}`
                : "Unassigned"}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
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
                  ? "font-medium text-[var(--status-warning-fg)]"
                  : "text-[var(--status-neutral)]"
              }`}
            >
              {labour.label}
            </p>
          ) : null}
        </div>
      </div>

      {job.decline_reason ? (
        <p className="alert-error mt-3">Declined: {job.decline_reason}</p>
      ) : null}

      {!readOnly ? (
        <div className="mt-4 flex flex-col gap-4">
          {canEdit ? (
            <form action={assignFormAction} className="flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1">
                <span className="field-label">Assign technician</span>
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
            <form action={approveFormAction} className="flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1">
                <span className="field-label">Approval method</span>
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
                  className="btn btn-danger"
                >
                  Record decline…
                </button>
              ) : (
                <form action={declineFormAction} className="flex flex-col gap-2">
                  <label className="block">
                    <span className="field-label">
                      Decline reason{" "}
                      <span className="text-[var(--status-danger)]">*</span>
                    </span>
                    <textarea
                      className="textarea"
                      name="decline_reason"
                      required
                      rows={3}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton
                      label="Confirm decline"
                      pendingLabel="Saving…"
                      variant="danger"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDecline(false)}
                      className="btn btn-secondary"
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
                variant="accent"
              />
            ) : null}
            {canMarkComplete ? (
              <StatusButton
                action={statusAction}
                status="completed"
                label="Complete job"
                variant="primary"
              />
            ) : null}
            {inspectionBlocksComplete &&
            (canComplete || isTechnicianSelf) &&
            Boolean(job.assigned_technician_id) &&
            (job.status === "in_progress" ||
              job.status === "approved" ||
              job.status === "ready_to_start") ? (
              <div className="w-full rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <p>Complete the inspection report before finishing jobs.</p>
                {inspectionHref ? (
                  <Link
                    href={inspectionHref}
                    className="mt-2 inline-flex btn btn-primary min-h-12"
                  >
                    Open inspection report
                  </Link>
                ) : null}
              </div>
            ) : null}
            {canEdit && job.status === "approved" ? (
              <StatusButton
                action={statusAction}
                status="ready_to_start"
                label="Mark ready"
                variant="secondary"
              />
            ) : null}
            {canEdit && job.status !== "cancelled" && job.status !== "completed" ? (
              !showCancel ? (
                <button
                  type="button"
                  onClick={() => setShowCancel(true)}
                  className="btn btn-secondary"
                >
                  Cancel job…
                </button>
              ) : (
                <form action={cancelFormAction} className="w-full flex flex-col gap-2">
                  <label className="block">
                    <span className="field-label">
                      Cancel note <span className="text-[var(--status-danger)]">*</span>
                    </span>
                    <textarea className="textarea" name="note" required rows={2} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton
                      label="Confirm cancel"
                      pendingLabel="Saving…"
                      variant="danger"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCancel(false)}
                      className="btn btn-secondary"
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
