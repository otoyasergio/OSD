"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  maybeSyncCustomerToWix,
  pullCustomerFromWix,
  syncCustomerToWix,
} from "@/lib/services/wixContacts";

export type WixCustomerFormState = {
  error: string | null;
  success: string | null;
};

export async function syncCustomerToWixAfterSave(
  customerId: string
): Promise<void> {
  await maybeSyncCustomerToWix(customerId);
}

export async function syncCustomerToWixAction(
  customerId: string,
  _prev: WixCustomerFormState,
  formData: FormData
): Promise<WixCustomerFormState> {
  void formData;
  try {
    await syncCustomerToWix(customerId);
  } catch (error) {
    return { error: toFormErrorMessage(error), success: null };
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { error: null, success: "Customer synced to Wix." };
}

export async function pullCustomerFromWixAction(
  customerId: string,
  _prev: WixCustomerFormState,
  formData: FormData
): Promise<WixCustomerFormState> {
  void formData;
  try {
    await pullCustomerFromWix(customerId);
  } catch (error) {
    return { error: toFormErrorMessage(error), success: null };
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { error: null, success: "Customer updated from Wix." };
}
