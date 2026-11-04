"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createCustomer,
  searchCustomers,
  updateCustomer,
  type Customer,
  type CustomerAccountType,
} from "@/lib/services/customers";
import { toFormErrorMessage } from "@/lib/services/errors";
import { zodFieldErrors } from "@/lib/validation/fieldErrors";
import { syncCustomerToWixAfterSave } from "@/app/(app)/customers/wix-actions";
import { savePrivateLicence } from "@/lib/services/customerPrivate";

export type CustomerFormState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
};

/** Typeahead search for intake and other customer pickers. */
export async function searchCustomersAction(query: string): Promise<Customer[]> {
  return searchCustomers(query, { preferShopCustomers: true });
}

export async function saveLicenceScanAction(
  customerId: string,
  scan: {
    firstName: string;
    lastName: string;
    address: string;
    dateOfBirth: string;
    licenceNumber: string;
    licenceExpiry: string;
  }
): Promise<{ error: string | null }> {
  try {
    const { getCustomerById, updateCustomer } = await import("@/lib/services/customers");
    const customer = await getCustomerById(customerId);
    if (!customer) return { error: "That customer no longer exists." };
    await updateCustomer(customerId, {
      first_name: scan.firstName || customer.first_name,
      last_name: scan.lastName || customer.last_name,
      phone: customer.phone,
      email: customer.email,
      address: scan.address || customer.address,
      date_of_birth: scan.dateOfBirth || customer.date_of_birth,
      notes: customer.notes,
      account_type: customer.account_type,
    });
    await savePrivateLicence(customerId, {
      licenceNumber: scan.licenceNumber,
      licenceExpiry: scan.licenceExpiry || null,
    });
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

function readCustomerInput(formData: FormData) {
  const accountType = String(formData.get("account_type") ?? "retail");
  return {
    first_name: String(formData.get("first_name") ?? ""),
    last_name: String(formData.get("last_name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    address: String(formData.get("address") ?? ""),
    date_of_birth: String(formData.get("date_of_birth") ?? ""),
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

export async function createCustomerAction(
  _prevState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  let customerId: string;

  try {
    const customer = await createCustomer(readCustomerInput(formData));
    customerId = customer.customer_id;
    await savePrivateLicence(customerId, {
      licenceNumber: String(formData.get("licence_number") ?? ""),
      licenceExpiry: String(formData.get("licence_expiry") ?? "") || null,
    });
    await syncCustomerToWixAfterSave(customerId);
  } catch (error) {
    return toCustomerFormError(error);
  }

  revalidatePath("/customers");

  const rawReturnTo = String(formData.get("return_to") ?? "").trim();
  const intakeReturnTo =
    rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : "/work_orders/new";

  let workOrderPath = `/work_orders/new?customer_id=${encodeURIComponent(customerId)}`;
  try {
    const url = new URL(intakeReturnTo, "https://example.invalid");
    if (url.pathname === "/work_orders/new") {
      url.searchParams.set("customer_id", customerId);
      workOrderPath = `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // keep default workOrderPath
  }

  redirect(
    `/motorcycles/new?customer_id=${encodeURIComponent(customerId)}&return_to=${encodeURIComponent(workOrderPath)}`
  );
}

export async function updateCustomerAction(
  customerId: string,
  _prevState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  try {
    await updateCustomer(customerId, readCustomerInput(formData));
    await savePrivateLicence(customerId, {
      licenceNumber: String(formData.get("licence_number") ?? ""),
      licenceExpiry: String(formData.get("licence_expiry") ?? "") || null,
    });
    await syncCustomerToWixAfterSave(customerId);
  } catch (error) {
    return toCustomerFormError(error);
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}
