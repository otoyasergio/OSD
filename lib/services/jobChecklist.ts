import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient } from "@/lib/database/types";
import { canCompleteJob } from "@/lib/permissions";

export const DEFAULT_JOB_CHECKLIST_TITLES = [
  "Perform work per SOP",
  "Verify fasteners/fluids/function",
  "Area clean / ready for QC",
] as const;

export type JobChecklistItem = {
  job_checklist_item_id: string;
  job_id: string;
  title: string;
  sort_order: number;
  checked_at: string | null;
  checked_by_user_id: string | null;
};

export async function seedDefaultJobChecklist(
  supabase: DbClient,
  jobId: string
): Promise<void> {
  const rows = DEFAULT_JOB_CHECKLIST_TITLES.map((title, index) => ({
    job_id: jobId,
    title,
    sort_order: index,
  }));
  const { error } = await supabase.from("job_checklist_item").insert(rows);
  if (error) throw error;
}

export async function listJobChecklist(jobId: string): Promise<JobChecklistItem[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_checklist_item")
    .select(
      "job_checklist_item_id, job_id, title, sort_order, checked_at, checked_by_user_id"
    )
    .eq("job_id", jobId)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  if ((data ?? []).length === 0) {
    await seedDefaultJobChecklist(supabase, jobId);
    const { data: seeded, error: seededError } = await supabase
      .from("job_checklist_item")
      .select(
        "job_checklist_item_id, job_id, title, sort_order, checked_at, checked_by_user_id"
      )
      .eq("job_id", jobId)
      .order("sort_order", { ascending: true });
    if (seededError) throw seededError;
    return (seeded as JobChecklistItem[]) ?? [];
  }

  return (data as JobChecklistItem[]) ?? [];
}

export async function toggleJobChecklistItem(
  itemId: string,
  checked: boolean
): Promise<void> {
  const user = await requireUser();
  if (!canCompleteJob(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: item, error: loadError } = await supabase
    .from("job_checklist_item")
    .select("job_checklist_item_id, job_id")
    .eq("job_checklist_item_id", itemId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!item) throw new Error("CHECKLIST_ITEM_NOT_FOUND");

  const { data: job, error: jobError } = await supabase
    .from("job")
    .select("assigned_technician_id, work_order_id")
    .eq("job_id", item.job_id)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) throw new Error("JOB_NOT_FOUND");

  if (user.role === "technician" && job.assigned_technician_id !== user.user_id) {
    throw new Error("JOB_NOT_ASSIGNED_TO_YOU");
  }

  const { error } = await supabase
    .from("job_checklist_item")
    .update({
      checked_at: checked ? new Date().toISOString() : null,
      checked_by_user_id: checked ? user.user_id : null,
    })
    .eq("job_checklist_item_id", itemId);
  if (error) throw error;
}
