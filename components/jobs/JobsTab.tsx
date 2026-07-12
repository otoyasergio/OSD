"use client";

import { useActionState } from "react";
import type { WorkOrderJob, TechnicianOption } from "@/lib/services/workOrders";
import {
  groupServicesByCategory,
  type Service,
} from "@/lib/services/serviceCatalogueShared";
import type { JobFormState } from "@/app/(app)/work_orders/job-actions";
import { JobCard } from "@/components/jobs/JobCard";
import { FormError, SELECT_CLASS } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { EmptyState } from "@/components/ui/EmptyState";

type Action = (
  state: JobFormState,
  formData: FormData
) => Promise<JobFormState>;

// Server action curried with work_order_id; jobId is bound client-side so no
// function factory has to cross the RSC boundary.
type JobAction = (
  jobId: string,
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
  inspectionComplete,
  inspectionHref,
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
  inspectionComplete?: boolean;
  inspectionHref?: string;
  addAction: Action;
  assignActionFor: JobAction;
  statusActionFor: JobAction;
  approveActionFor: JobAction;
  declineActionFor: JobAction;
  cancelActionFor: JobAction;
}) {
  const [addState, addFormAction] = useActionState(addAction, { error: null });
  const groupedServices = groupServicesByCategory(services);

  return (
    <div className="flex flex-col gap-4">
      {canAdd && !readOnly ? (
        <form
          action={addFormAction}
          className="card card-body flex flex-wrap items-end gap-3"
        >
          <label className="min-w-[14rem] flex-1">
            <span className="field-label">Add service job</span>
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
          <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--foreground)]">
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
        <EmptyState
          variant="jobs"
          description="No jobs on this work order yet."
        />
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
              inspectionComplete={inspectionComplete}
              inspectionHref={inspectionHref}
              assignAction={assignActionFor.bind(null, job.job_id)}
              statusAction={statusActionFor.bind(null, job.job_id)}
              approveAction={approveActionFor.bind(null, job.job_id)}
              declineAction={declineActionFor.bind(null, job.job_id)}
              cancelAction={cancelActionFor.bind(null, job.job_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
