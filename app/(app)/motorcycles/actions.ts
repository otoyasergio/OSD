"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createMotorcycle,
  updateMotorcycle,
  updateMotorcycleServiceInformation,
  SERVICE_INFORMATION_FIELDS,
  type ServiceInformationInput,
} from "@/lib/services/motorcycles";
import { toFormErrorMessage } from "@/lib/services/errors";

export type MotorcycleFormState = { error: string | null };

function readMotorcycleInput(formData: FormData) {
  const yearRaw = String(formData.get("year") ?? "").trim();
  return {
    customer_id: String(formData.get("customer_id") ?? ""),
    year: yearRaw ? Number(yearRaw) : Number.NaN,
    make: String(formData.get("make") ?? ""),
    model: String(formData.get("model") ?? ""),
    vin: String(formData.get("vin") ?? ""),
    colour: String(formData.get("colour") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function createMotorcycleAction(
  _prevState: MotorcycleFormState,
  formData: FormData
): Promise<MotorcycleFormState> {
  const input = readMotorcycleInput(formData);
  if (!Number.isFinite(input.year)) {
    return { error: "Year is required." };
  }

  let motorcycleId: string;
  try {
    const motorcycle = await createMotorcycle(input);
    motorcycleId = motorcycle.motorcycle_id;
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/motorcycles");
  revalidatePath(`/customers/${input.customer_id}`);
  redirect(`/motorcycles/${motorcycleId}`);
}

export async function updateMotorcycleAction(
  motorcycleId: string,
  _prevState: MotorcycleFormState,
  formData: FormData
): Promise<MotorcycleFormState> {
  const input = readMotorcycleInput(formData);
  if (!Number.isFinite(input.year)) {
    return { error: "Year is required." };
  }

  try {
    await updateMotorcycle(motorcycleId, input);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/motorcycles");
  revalidatePath(`/motorcycles/${motorcycleId}`);
  return { error: null };
}

export async function updateServiceInformationAction(
  motorcycleId: string,
  _prevState: MotorcycleFormState,
  formData: FormData
): Promise<MotorcycleFormState> {
  const input: ServiceInformationInput = {};
  for (const field of SERVICE_INFORMATION_FIELDS) {
    input[field] = String(formData.get(field) ?? "");
  }

  try {
    await updateMotorcycleServiceInformation(motorcycleId, input);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/motorcycles/${motorcycleId}`);
  return { error: null };
}
