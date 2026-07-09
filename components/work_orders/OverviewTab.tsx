"use client";

import { useActionState } from "react";
import type { WorkOrderDetail, TechnicianOption } from "@/lib/services/workOrders";
import type { WorkOrderFormState } from "@/app/(app)/work_orders/actions";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

type Action = (
  state: WorkOrderFormState,
  formData: FormData
) => Promise<WorkOrderFormState>;

export function OverviewTab({
  detail,
  technicians,
  canAssign,
  readOnly,
  assignAction,
  setPrimaryAction,
}: {
  detail: WorkOrderDetail;
  technicians: TechnicianOption[];
  canAssign: boolean;
  readOnly: boolean;
  assignAction: Action;
  setPrimaryAction: Action;
}) {
  const [assignState, assignFormAction] = useActionState(assignAction, {
    error: null,
  });
  const [primaryState, primaryFormAction] = useActionState(setPrimaryAction, {
    error: null,
  });

  const assignedIds = new Set(
    detail.technicians.map((row) => row.technician_id)
  );

  return (
    <div className="flex flex-col gap-6">
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

      {canAssign && !readOnly ? (
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
                <span className="text-zinc-600">{job.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
