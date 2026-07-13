"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import {
  createCustomer,
  searchCustomers,
  updateCustomer,
  type Customer,
  type CustomerAccountType,
} from "@/lib/services/customers";
import { applySmsConsent } from "@/lib/services/smsConsent";
import { toFormErrorMessage } from "@/lib/services/errors";
import { zodFieldErrors } from "@/lib/validation/fieldErrors";
import { syncCustomerToWixAfterSave } from "@/app/(app)/customers/wix-actions";

export type CustomerFormState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
};

/** Typeahead search for intake and other customer pickers. */
export async function searchCustomersAction(query: string): Promise<Customer[]> {
  return searchCustomers(query);
}

function readCustomerInput(formData: FormData) {
  const accountType = String(formData.get("account_type") ?? "retail");
  return {
    first_name: String(formData.get("first_name") ?? ""),
    last_name: String(formData.get("last_name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    account_type: accountType as CustomerAccountType,
  };
}

function toCustomerFormError(error: unknown): CustomerFormState {
  if (error instanceof ZodError) {
    return {
      error: error.issues[0]?.message ?? "Please check the details and try again.",
      fieldErrors: zodFieldErrors(error),
    };
  }
  return { error: toFormErrorMessage(error) };
}

async function applyStaffCustomerFormConsent(
  customerId: string,
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  await applySmsConsent({
    customerId,
    transactional: formData.get("sms_transactional") === "on",
    marketing: formData.get("sms_marketing") === "on",
    method: "staff",
    sourcePath: "staff:customer_form",
    actorUserId: user.user_id,
    sendWelcome: true,
  });
}

export async function createCustomerAction(
  _prevState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  let customerId: string;

  try {
    const customer = await createCustomer(readCustomerInput(formData));
    customerId = customer.customer_id;
    await applyStaffCustomerFormConsent(customerId, formData);
    await syncCustomerToWixAfterSave(customerId);
  } catch (error) {
    return toCustomerFormError(error);
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
    await applyStaffCustomerFormConsent(customerId, formData);
    await syncCustomerToWixAfterSave(customerId);
  } catch (error) {
    return toCustomerFormError(error);
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}
