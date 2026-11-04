export type ShopInstruction = {
  id: string;
  jobId: string | null;
  label: string;
  body: string;
};

/** Intake and job-line instructions. These are not technician_note rows. */
export function shopInstructions(input: {
  internalNotes?: string | null;
  jobs: Array<{ job_id: string; service_name: string; notes?: string | null }>;
}): ShopInstruction[] {
  const items: ShopInstruction[] = [];
  const internal = input.internalNotes?.trim();
  if (internal) {
    items.push({
      id: "internal",
      jobId: null,
      label: "Work order",
      body: internal,
    });
  }
  for (const job of input.jobs) {
    const body = job.notes?.trim();
    if (!body) continue;
    items.push({
      id: `job:${job.job_id}`,
      jobId: job.job_id,
      label: job.service_name,
      body,
    });
  }
  return items;
}

/** Floor notes written against one job. Work-order notes stay on the visit. */
export function technicianNotesForJob<T extends { job_id: string | null }>(
  notes: T[],
  jobId: string
): T[] {
  return notes.filter((note) => note.job_id === jobId);
}

/**
 * PostgREST `or` filter for the bench: this job's notes and notes the shop
 * left on the work order without picking a job.
 */
export function technicianNotesOnBenchFilter(jobId: string): string {
  return `job_id.eq.${jobId},job_id.is.null`;
}
