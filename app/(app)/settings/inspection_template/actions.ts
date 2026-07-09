"use server";

import { revalidatePath } from "next/cache";
import {
  createInspectionTemplateItem,
  setInspectionTemplateItemActive,
  swapInspectionTemplateItemOrder,
  updateInspectionTemplateItem,
} from "@/lib/services/inspectionTemplate";
import { toFormErrorMessage } from "@/lib/services/errors";

export type TemplateFormState = { error: string | null };

function readBool(formData: FormData, key: string): boolean {
  return formData.get(key) === "true";
}

function readOrder(formData: FormData): number {
  const raw = String(formData.get("display_order") ?? "").trim();
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

export async function createTemplateItemAction(
  _prevState: TemplateFormState,
  formData: FormData
): Promise<TemplateFormState> {
  try {
    await createInspectionTemplateItem({
      category: String(formData.get("category") ?? "").trim(),
      item_name: String(formData.get("item_name") ?? "").trim(),
      display_order: readOrder(formData),
      requires_measurement: readBool(formData, "requires_measurement"),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/settings/inspection_template");
  return { error: null };
}

export async function updateTemplateItemAction(
  templateItemId: string,
  _prevState: TemplateFormState,
  formData: FormData
): Promise<TemplateFormState> {
  try {
    await updateInspectionTemplateItem(templateItemId, {
      category: String(formData.get("category") ?? "").trim(),
      item_name: String(formData.get("item_name") ?? "").trim(),
      display_order: readOrder(formData),
      requires_measurement: readBool(formData, "requires_measurement"),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/settings/inspection_template");
  return { error: null };
}

export async function toggleTemplateItemActiveAction(
  templateItemId: string,
  active: boolean
): Promise<void> {
  await setInspectionTemplateItemActive(templateItemId, active);
  revalidatePath("/settings/inspection_template");
}

export async function swapTemplateItemOrderAction(
  itemIdA: string,
  itemIdB: string
): Promise<void> {
  await swapInspectionTemplateItemOrder(itemIdA, itemIdB);
  revalidatePath("/settings/inspection_template");
}
