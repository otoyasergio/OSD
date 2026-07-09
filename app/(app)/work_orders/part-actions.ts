"use server";

import { revalidatePath } from "next/cache";
import { addPartToJob, updatePartStatus } from "@/lib/services/parts";
import { toFormErrorMessage } from "@/lib/services/errors";
import type { PartStatus } from "@/lib/database/types";

export type PartFormState = { error: string | null };

function revalidateParts(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/work_orders");
}

export async function addPartAction(
  workOrderId: string,
  _prevState: PartFormState,
  formData: FormData
): Promise<PartFormState> {
  try {
    const quantityRaw = String(formData.get("quantity") ?? "1").trim();
    const quantity = Number(quantityRaw);
    await addPartToJob(String(formData.get("job_id") ?? ""), {
      part_name: String(formData.get("part_name") ?? "").trim(),
      part_number: String(formData.get("part_number") ?? "").trim() || null,
      supplier: String(formData.get("supplier") ?? "").trim() || null,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateParts(workOrderId);
  return { error: null };
}

export async function updatePartStatusAction(
  workOrderId: string,
  partId: string,
  _prevState: PartFormState,
  formData: FormData
): Promise<PartFormState> {
  try {
    await updatePartStatus(
      partId,
      String(formData.get("status") ?? "") as PartStatus
    );
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateParts(workOrderId);
  return { error: null };
}
