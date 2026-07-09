"use server";

import { revalidatePath } from "next/cache";
import {
  createService,
  updateService,
  setServiceActive,
} from "@/lib/services/serviceCatalogue";
import { toFormErrorMessage } from "@/lib/services/errors";

export type ServiceFormState = { error: string | null };

function readNumber(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function createServiceAction(
  _prevState: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  try {
    await createService({
      name: String(formData.get("name") ?? "").trim(),
      standard_price: readNumber(formData, "standard_price"),
      estimated_labour: readNumber(formData, "estimated_labour"),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/settings/services");
  return { error: null };
}

export async function updateServiceAction(
  serviceId: string,
  _prevState: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  try {
    await updateService(serviceId, {
      name: String(formData.get("name") ?? "").trim(),
      standard_price: readNumber(formData, "standard_price"),
      estimated_labour: readNumber(formData, "estimated_labour"),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/settings/services");
  return { error: null };
}

export async function toggleServiceActiveAction(
  serviceId: string,
  active: boolean
): Promise<void> {
  await setServiceActive(serviceId, active);
  revalidatePath("/settings/services");
}
