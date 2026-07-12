import Link from "next/link";
import type { WorkOrderJob } from "@/lib/services/workOrders";
import { JOB_STATUS_LABELS } from "@/lib/status/labels";
import type { JobStatus } from "@/lib/database/types";

const DONE_STATUSES = new Set<JobStatus>(["completed", "cancelled"]);

function jobDotClass(status: JobStatus): string {
  if (status === "completed") return "bg-[var(--status-success)]";
  if (status === "in_progress") return "bg-[var(--status-info)]";
  if (status === "waiting_for_approval" || status === "draft") {
    return "bg-[var(--status-warning)]";
  }
  return "bg-[var(--status-neutral)]";
}

export function WorkOrderJobTodo({
  jobs,
  workOrderId,
}: {
  jobs: WorkOrderJob[];
  workOrderId: string;
}) {
  if (jobs.length === 0) return null;

  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const activeJobs = jobs.filter((job) => !DONE_STATUSES.has(job.status));

  return (
    <div className="border-t border-border px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--status-neutral)]">
          To-do · {completedCount}/{jobs.length} complete
        </p>
        <Link
          href={`/work_orders/${workOrderId}?tab=jobs`}
          className="text-xs font-semibold text-[var(--accent-hover)] underline-offset-2 hover:underline"
        >
          Manage jobs
        </Link>
      </div>
      {activeJobs.length === 0 ? (
        <p className="mt-2 text-sm font-medium text-[var(--status-success-fg)]">
          All jobs complete.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {activeJobs.slice(0, 6).map((job) => (
            <li key={job.job_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${jobDotClass(job.status)}`}
              />
              <span className="font-medium text-foreground">
                {job.service_name_snapshot}
              </span>
              <span className="text-[var(--status-neutral)]">
                {JOB_STATUS_LABELS[job.status]}
                {job.assigned_technician
                  ? ` · ${job.assigned_technician.first_name} ${job.assigned_technician.last_name}`
                  : ""}
              </span>
            </li>
          ))}
          {activeJobs.length > 6 ? (
            <li className="text-xs text-[var(--status-neutral)]">
              +{activeJobs.length - 6} more open jobs
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
