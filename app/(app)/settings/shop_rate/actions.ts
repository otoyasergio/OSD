"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import { updateActiveLocationShopRate } from "@/lib/services/shopRate";

export type ShopRateFormState = {
  error: string | null;
  saved: boolean;
};

export async function updateShopRateAction(
  _previous: ShopRateFormState,
  formData: FormData
): Promise<ShopRateFormState> {
  try {
    await updateActiveLocationShopRate({
      hourly_rate: String(formData.get("hourly_rate") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }

  revalidatePath("/settings/shop_rate");
  revalidatePath("/settings/locations");
  revalidatePath("/work_orders/new");
  return { error: null, saved: true };
}
