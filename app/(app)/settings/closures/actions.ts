"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import { addShopClosure, deleteShopClosure } from "@/lib/services/shopClosures";

export type ShopClosureFormState = {
  error: string | null;
  saved: boolean;
};

export async function addShopClosureAction(
  _previous: ShopClosureFormState,
  formData: FormData
): Promise<ShopClosureFormState> {
  try {
    await addShopClosure({
      closure_date: String(formData.get("closure_date") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }

  revalidatePath("/settings/closures");
  revalidatePath("/work_orders/new");
  return { error: null, saved: true };
}

export async function deleteShopClosureAction(closureDate: string): Promise<void> {
  await deleteShopClosure(closureDate);
  revalidatePath("/settings/closures");
  revalidatePath("/work_orders/new");
}
