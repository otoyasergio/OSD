"use client";

import { useActionState } from "react";
import type { WorkOrderJob, TechnicianOption } from "@/lib/services/workOrders";
import {
  groupServicesByCategory,
  type Service,
} from "@/lib/services/serviceCatalogue";
import type { JobFormState } from "@/app/(app)/work_orders/job-actions";
import { JobCard } from "@/components/jobs/JobCard";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

type Action = (
  state: JobFormState,
  formData: FormData
) => Promise<JobFormState>;

export function JobsTab({
  jobs,
  services,
  technicians,
  readOnly,
  canAdd,
  canApprove,
  canEdit,
  canComplete,
  currentUserId,
  addAction,
  assignActionFor,
  statusActionFor,
  approveActionFor,
  declineActionFor,
  cancelActionFor,
}: {
  jobs: WorkOrderJob[];
  services: Service[];
  technicians: TechnicianOption[];
  readOnly: boolean;
  canAdd: boolean;
  canApprove: boolean;
  canEdit: boolean;
  canComplete: boolean;
  currentUserId: string;
  addAction: Action;
  assignActionFor: (jobId: string) => Action;
  statusActionFor: (jobId: string) => Action;
  approveActionFor: (jobId: string) => Action;
  declineActionFor: (jobId: string) => Action;
  cancelActionFor: (jobId: string) => Action;
}) {
  const [addState, addFormAction] = useActionState(addAction, { error: null });
  const groupedServices = groupServicesByCategory(services);

  return (
    <div className="flex flex-col gap-4">
      {canAdd && !readOnly ? (
        <form
          action={addFormAction}
          className="flex flex-wrap items-end gap-3 rounded border border-zinc-200 bg-white p-4"
        >
          <label className="min-w-[14rem] flex-1">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Add service job
            </span>
            <select className={SELECT_CLASS} name="service_id" required defaultValue="">
              <option value="">Select service</option>
              {groupedServices.map(({ category, services: categoryServices }) => (
                <optgroup key={category} label={category}>
                  {categoryServices.map((service) => (
                    <option key={service.service_id} value={service.service_id}>
                      {service.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              name="require_approval"
              value="true"
              defaultChecked
              className="h-4 w-4"
            />
            Requires customer approval
          </label>
          <SubmitButton label="Add job" pendingLabel="Adding…" />
          <FormError message={addState.error} />
        </form>
      ) : null}

      {jobs.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          No jobs on this work order yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => (
            <JobCard
              key={job.job_id}
              job={job}
              technicians={technicians}
              readOnly={readOnly}
              canApprove={canApprove}
              canEdit={canEdit}
              canComplete={canComplete}
              isTechnicianSelf={job.assigned_technician_id === currentUserId}
              assignAction={assignActionFor(job.job_id)}
              statusAction={statusActionFor(job.job_id)}
              approveAction={approveActionFor(job.job_id)}
              declineAction={declineActionFor(job.job_id)}
              cancelAction={cancelActionFor(job.job_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
