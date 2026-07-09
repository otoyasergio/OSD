"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { JobFormState } from "@/app/(app)/work_orders/job-actions";
import type { JobStatus } from "@/lib/database/types";
import { FormError } from "@/components/forms/Field";

type StatusAction = (
  state: JobFormState,
  formData: FormData
) => Promise<JobFormState>;

function JobStatusForm({
  action,
  status,
  label,
  variant = "secondary",
}: {
  action: StatusAction;
  status: JobStatus;
  label: string;
  variant?: "primary" | "accent" | "secondary";
}) {
  const [state, formAction] = useActionState(action, { error: null });
  const btnClass =
    variant === "accent"
      ? "btn btn-accent flex-1 sm:flex-none"
      : variant === "primary"
        ? "btn btn-primary flex-1 sm:flex-none"
        : "btn btn-secondary flex-1 sm:flex-none";

  return (
    <form action={formAction} className="inline-flex min-w-0 flex-1 flex-col sm:flex-none">
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={btnClass}>
        {label}
      </button>
      <FormError message={state.error} />
    </form>
  );
}

export function TechnicianJobCard({
  serviceName,
  status,
  statusLabel,
  workOrderNumber,
  customerLabel,
  motorcycleLabel,
  workOrderStatusLabel,
  workOrderHref,
  inspectionHref,
  inspectionComplete,
  canStart,
  canComplete,
  startAction,
  completeAction,
}: {
  serviceName: string;
  status: JobStatus;
  statusLabel: string;
  workOrderNumber: string;
  customerLabel: string;
  motorcycleLabel: string;
  workOrderStatusLabel: string;
  workOrderHref: string;
  inspectionHref?: string;
  inspectionComplete?: boolean;
  canStart: boolean;
  canComplete: boolean;
  startAction?: StatusAction;
  completeAction?: StatusAction;
}) {
  const inspectionBlocksComplete =
    canComplete && inspectionComplete === false && Boolean(inspectionHref);
  const showComplete = canComplete && !inspectionBlocksComplete;
  const showPrimaryCta = canStart || showComplete || inspectionBlocksComplete;
  const preferInspection =
    Boolean(inspectionHref) && inspectionComplete === false;
  const openHref =
    preferInspection && inspectionHref ? inspectionHref : workOrderHref;
  const openLabel = preferInspection
    ? "Open inspection report"
    : "Open WO";

  return (
    <article className="tech-job-card">
      <div className="tech-job-card-hero">
        <p className="tech-job-card-bike">{motorcycleLabel}</p>
        <p className="tech-job-card-customer">{customerLabel}</p>
        <p className="tech-job-card-service">{serviceName}</p>
      </div>

      <div className="tech-job-card-meta">
        <span className="tech-job-card-wo">{workOrderNumber}</span>
        <span className="tech-job-card-status">{statusLabel}</span>
        <span className="tech-job-card-wo-status">{workOrderStatusLabel}</span>
      </div>

      {inspectionBlocksComplete ? (
        <p className="tech-job-card-hint" role="status">
          Complete the inspection report before finishing this job.
        </p>
      ) : null}

      <div className="tech-job-card-actions">
        {canStart && startAction ? (
          <JobStatusForm
            action={startAction}
            status="in_progress"
            label="Start job"
            variant="accent"
          />
        ) : null}
        {showComplete && completeAction ? (
          <JobStatusForm
            action={completeAction}
            status="completed"
            label="Complete job"
            variant="primary"
          />
        ) : null}
        <Link
          href={openHref}
          className={`btn flex-1 sm:flex-none ${
            preferInspection || !showComplete ? "btn-primary" : "btn-secondary"
          }`}
        >
          {openLabel}
        </Link>
        {preferInspection ? (
          <Link
            href={workOrderHref}
            className="btn btn-secondary flex-1 sm:flex-none"
          >
            Jobs
          </Link>
        ) : null}
      </div>

      {!showPrimaryCta ? (
        <p className="tech-job-card-hint">
          {status === "waiting_for_approval"
            ? "Waiting for customer approval before work can start."
            : status === "waiting_for_parts"
              ? "Waiting for parts before work can start."
              : "No start/complete action available for this job right now."}
        </p>
      ) : null}
    </article>
  );
}
