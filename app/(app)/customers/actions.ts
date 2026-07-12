"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createCustomer, updateCustomer } from "@/lib/services/customers";
import { toFormErrorMessage } from "@/lib/services/errors";
import { syncCustomerToWixAfterSave } from "@/app/(app)/customers/wix-actions";

export type CustomerFormState = { error: string | null };

function readCustomerInput(formData: FormData) {
  return {
    first_name: String(formData.get("first_name") ?? ""),
    last_name: String(formData.get("last_name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function createCustomerAction(
  _prevState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  let customerId: string;

  try {
    const customer = await createCustomer(readCustomerInput(formData));
    customerId = customer.customer_id;
    await syncCustomerToWixAfterSave(customerId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/customers");
  redirect(`/customers/${customerId}`);
}

export async function updateCustomerAction(
  customerId: string,
  _prevState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  try {
    await updateCustomer(customerId, readCustomerInput(formData));
    await syncCustomerToWixAfterSave(customerId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}
