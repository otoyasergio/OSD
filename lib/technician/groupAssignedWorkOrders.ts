export type AssignedJobForGrouping = {
  job_id: string;
  work_order_id: string;
  status: string;
};

export type AssignedWorkOrderGroup<T extends AssignedJobForGrouping> = {
  work_order_id: string;
  jobs: T[];
  representative: T;
  is_active: boolean;
};

/**
 * Turn a job-ordered docket into one motorcycle/work-order entry. An active
 * job represents the group so opening a motorcycle always resumes current
 * work; otherwise the first advisor-ordered job is used.
 */
export function groupAssignedJobsByWorkOrder<T extends AssignedJobForGrouping>(
  orderedJobs: readonly T[]
): AssignedWorkOrderGroup<T>[] {
  const byWorkOrder = new Map<string, T[]>();

  for (const job of orderedJobs) {
    const group = byWorkOrder.get(job.work_order_id);
    if (group) group.push(job);
    else byWorkOrder.set(job.work_order_id, [job]);
  }

  return [...byWorkOrder.entries()]
    .map(([workOrderId, jobs]) => {
      const active = jobs.find((job) => job.status === "in_progress");
      return {
        work_order_id: workOrderId,
        jobs,
        representative: active ?? jobs[0],
        is_active: Boolean(active),
      };
    })
    .sort((a, b) => Number(b.is_active) - Number(a.is_active));
}
