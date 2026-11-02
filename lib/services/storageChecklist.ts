import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { shopDateKey } from "@/lib/datetime/format";
import { canEditStorageTerms } from "@/lib/permissions";
import { buildStorageChecklist, type StorageChecklist } from "@/lib/storage/checklist";
import {
  isPastStoragePickupDate,
  parseStorageMonthlyCents,
  parseStoragePickupDate,
} from "@/lib/storage/terms";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";

export type StorageChecklistSnapshot = StorageChecklist & {
  today: string;
  bikeLabel: string;
};

export async function loadStorageChecklist(
  workOrderId: string
): Promise<StorageChecklistSnapshot> {
  const user = await requireUser();
  if (!canEditStorageTerms(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      location_id,
      customer:customer_id ( phone ),
      motorcycle:motorcycle_id ( year, make, model ),
      inspection ( completed_at ),
      job ( job_id, status, service_name_snapshot, part ( part_name, status ) )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("WORK_ORDER_NOT_FOUND");
  const row = data as unknown as {
    location_id: string;
    customer: { phone: string | null } | Array<{ phone: string | null }> | null;
    motorcycle:
      | { year: number | null; make: string | null; model: string | null }
      | Array<{ year: number | null; make: string | null; model: string | null }>
      | null;
    inspection: { completed_at: string | null } | Array<{ completed_at: string | null }> | null;
    job: Array<{
      job_id: string;
      status: string;
      service_name_snapshot: string | null;
      part: Array<{ part_name: string | null; status: string }> | null;
    }> | null;
  };
  if (row.location_id !== user.active_location_id) throw new Error("FOREIGN_LOCATION");
  const customer = one(row.customer);
  const motorcycle = one(row.motorcycle);
  const inspection = one(row.inspection);
  const jobs = row.job ?? [];
  const checklist = buildStorageChecklist({
    inspectionComplete: Boolean(inspection?.completed_at),
    phone: customer?.phone ?? null,
    jobs: jobs.map((job) => ({
      jobId: job.job_id,
      name: job.service_name_snapshot ?? "Work",
      status: job.status,
    })),
    parts: jobs.flatMap((job) =>
      (job.part ?? []).map((part) => ({
        jobId: job.job_id,
        name: part.part_name ?? "Part",
        status: part.status,
      }))
    ),
  });
  const bikeLabel = [motorcycle?.year, motorcycle?.make, motorcycle?.model]
    .filter((part) => part != null && String(part).trim() !== "")
    .join(" ");
  return {
    ...checklist,
    today: shopDateKey(new Date()),
    bikeLabel: bikeLabel || "This motorcycle",
  };
}

export async function updateStorageTerms(input: {
  workOrderId: string;
  pickupBy: string;
  monthlyAmount: string;
}): Promise<void> {
  const user = await requireUser();
  if (!canEditStorageTerms(user.role)) throw new Error("FORBIDDEN");
  const today = shopDateKey(new Date());
  const pickupBy = parseStoragePickupDate(input.pickupBy, today);
  if (!pickupBy) {
    throw new Error(
      isPastStoragePickupDate(input.pickupBy, today)
        ? "STORAGE_PICKUP_DATE_PAST"
        : "STORAGE_PICKUP_DATE_REQUIRED"
    );
  }
  const monthlyCents = parseStorageMonthlyCents(input.monthlyAmount);
  if (monthlyCents == null) throw new Error("STORAGE_MONTHLY_AMOUNT_REQUIRED");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, status")
    .eq("work_order_id", input.workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("WORK_ORDER_NOT_FOUND");
  if (data.location_id !== user.active_location_id) throw new Error("FOREIGN_LOCATION");
  if (data.status !== "in_storage") throw new Error("STORAGE_TERMS_NOT_STORED");

  const { error: updateError } = await supabase
    .from("work_order")
    .update({
      storage_pickup_by: pickupBy,
      storage_monthly_cents: monthlyCents,
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", input.workOrderId);
  if (updateError) throw updateError;

  await addTimelineEvent(supabase, {
    work_order_id: input.workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.WORK_ORDER_STATUS_CHANGED,
    entity_type: "work_order",
    entity_id: input.workOrderId,
    description: `Storage pickup date set to ${pickupBy}`,
    new_value: {
      storage_pickup_by: pickupBy,
      storage_monthly_cents: monthlyCents,
    },
  });
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
