"use client";

import { useActionState } from "react";
import type { Part } from "@/lib/services/parts";
import type { WorkOrderJob } from "@/lib/services/workOrders";
import type { PartFormState } from "@/app/(app)/work_orders/part-actions";
import type { JobStatus, PartStatus } from "@/lib/database/types";
import { JOB_STATUS_LABELS, PART_STATUS_LABELS } from "@/lib/status/labels";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Action = (
  state: PartFormState,
  formData: FormData
) => Promise<PartFormState>;

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

const ORDERABLE_JOB_STATUSES: JobStatus[] = [
  "approved",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
];

const STATUS_TRANSITIONS: PartStatus[] = [
  "needed",
  "in_stock",
  "ordered",
  "installed",
  "not_required",
  "cancelled",
];

function canOrderForJob(status: JobStatus | undefined): boolean {
  if (!status) return false;
  return ORDERABLE_JOB_STATUSES.includes(status);
}

export function PartsTab({
  parts,
  jobs,
  readOnly,
  canManage,
  canInstall,
  addAction,
  statusActionFor,
}: {
  parts: Part[];
  jobs: WorkOrderJob[];
  readOnly: boolean;
  canManage: boolean;
  canInstall: boolean;
  addAction: Action;
  statusActionFor: (partId: string) => Action;
}) {
  const [addState, addFormAction] = useActionState(addAction, { error: null });
  const activeJobs = jobs.filter(
    (job) => job.status !== "cancelled" && job.status !== "declined"
  );

  return (
    <div className="flex flex-col gap-4">
      {!readOnly && canManage ? (
        <form
          action={addFormAction}
          className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4"
        >
          <h3 className="text-base font-semibold text-zinc-900">Add part</h3>
          <FormError message={addState.error} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Job <span className="text-red-600">*</span>
            </span>
            <select className={SELECT_CLASS} name="job_id" required defaultValue="">
              <option value="">Select job</option>
              {activeJobs.map((job) => (
                <option key={job.job_id} value={job.job_id}>
                  {job.service_name_snapshot} (
                  {JOB_STATUS_LABELS[job.status] ?? job.status})
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Part name" name="part_name" required />
            <TextField label="Part number" name="part_number" />
            <TextField label="Supplier" name="supplier" />
            <TextField
              label="Quantity"
              name="quantity"
              type="number"
              defaultValue={1}
            />
          </div>
          <TextField label="Notes" name="notes" />
          <div>
            <SubmitButton label="Add part" pendingLabel="Adding…" />
          </div>
          <p className="text-xs text-zinc-500">
            Parts can be listed before approval. Ordering is blocked until the
            job is approved.
          </p>
        </form>
      ) : null}

      {parts.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          No parts on this work order yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {parts.map((part) => (
            <PartCard
              key={part.part_id}
              part={part}
              readOnly={readOnly}
              canManage={canManage}
              canInstall={canInstall}
              statusAction={statusActionFor(part.part_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PartCard({
  part,
  readOnly,
  canManage,
  canInstall,
  statusAction,
}: {
  part: Part;
  readOnly: boolean;
  canManage: boolean;
  canInstall: boolean;
  statusAction: Action;
}) {
  const [state, formAction] = useActionState(statusAction, { error: null });
  const jobStatus = part.job?.status;
  const orderAllowed = canOrderForJob(jobStatus);

  return (
    <article className="rounded border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">
            {part.part_name}
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            {PART_STATUS_LABELS[part.status]} · qty {part.quantity}
            {part.job
              ? ` · ${part.job.service_name_snapshot} (${JOB_STATUS_LABELS[part.job.status]})`
              : ""}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {[part.part_number, part.supplier].filter(Boolean).join(" · ") ||
              "No part # / supplier"}
          </p>
          {part.notes ? (
            <p className="mt-2 text-sm text-zinc-700">{part.notes}</p>
          ) : null}
        </div>
      </div>

      {!readOnly && (canManage || canInstall) ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {STATUS_TRANSITIONS.filter((status) => status !== part.status).map(
              (status) => {
                if (status === "ordered" && !canManage) return null;
                if (status === "ordered" && !orderAllowed) return null;
                if (
                  status === "installed" &&
                  !canInstall &&
                  !canManage
                ) {
                  return null;
                }
                if (
                  status !== "ordered" &&
                  status !== "installed" &&
                  !canManage
                ) {
                  return null;
                }

                return (
                  <form key={status} action={formAction} className="inline">
                    <input type="hidden" name="status" value={status} />
                    <button
                      type="submit"
                      className="min-h-11 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
                    >
                      Mark {PART_STATUS_LABELS[status].toLowerCase()}
                    </button>
                  </form>
                );
              }
            )}
          </div>
          {part.status !== "ordered" && canManage && !orderAllowed ? (
            <p className="text-sm text-amber-800">
              Ordering is blocked until this job is approved by the customer.
            </p>
          ) : null}
          <FormError message={state.error} />
        </div>
      ) : null}
    </article>
  );
}
