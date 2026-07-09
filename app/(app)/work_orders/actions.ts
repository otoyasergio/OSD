"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createWorkOrder } from "@/lib/services/workOrders";
import { toFormErrorMessage } from "@/lib/services/errors";
import { requireUser } from "@/lib/auth/session";

export type WorkOrderFormState = { error: string | null };

function readOptionalNumber(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function readEstimatedCompletion(formData: FormData): string | null {
  const raw = String(formData.get("estimated_completion") ?? "").trim();
  if (!raw) return null;
  // datetime-local values lack timezone; treat as local and convert to ISO.
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export async function createWorkOrderAction(
  _prevState: WorkOrderFormState,
  formData: FormData
): Promise<WorkOrderFormState> {
  let workOrderId: string;

  try {
    const user = await requireUser();
    const serviceIds = formData
      .getAll("service_ids")
      .map((value) => String(value))
      .filter(Boolean);

    const primaryTech = String(formData.get("primary_technician_id") ?? "").trim();

    const result = await createWorkOrder({
      motorcycle_id: String(formData.get("motorcycle_id") ?? ""),
      location_id: user.active_location_id!,
      external_invoice_number: String(
        formData.get("external_invoice_number") ?? ""
      ),
      mileage: readOptionalNumber(formData, "mileage"),
      estimated_completion: readEstimatedCompletion(formData),
      internal_notes: String(formData.get("internal_notes") ?? ""),
      primary_technician_id: primaryTech || null,
      service_ids: serviceIds,
    });
    workOrderId = result.work_order_id;
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/work_orders");
  redirect(`/work_orders/${workOrderId}`);
}
