"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createMotorcycle,
  updateMotorcycle,
  updateMotorcycleServiceInformation,
  transferMotorcycle,
  getMotorcycleById,
  findMotorcycleByVin,
  lookupVinOwnershipConflict,
  buildVinOwnershipConflict,
  SERVICE_INFORMATION_FIELDS,
  type ServiceInformationInput,
  type VinOwnershipConflict,
} from "@/lib/services/motorcycles";
import { toFormErrorMessage } from "@/lib/services/errors";
import { validateOptionalVin } from "@/lib/vin";

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
  revalidatePath(`/customers/${input.customer_id}`);
  return { error: null };
}

export async function transferMotorcycleAction(
  motorcycleId: string,
  _prevState: MotorcycleFormState,
  formData: FormData
): Promise<MotorcycleFormState> {
  const newCustomerId = String(formData.get("new_customer_id") ?? "").trim();
  if (!newCustomerId) {
    return { error: "Select a customer to transfer to." };
  }

  let fromCustomerId: string | null = null;
  try {
    const previous = await getMotorcycleById(motorcycleId);
    fromCustomerId = previous?.customer_id ?? null;
    await transferMotorcycle({
      motorcycle_id: motorcycleId,
      new_customer_id: newCustomerId,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/motorcycles");
  revalidatePath(`/motorcycles/${motorcycleId}`);
  revalidatePath(`/customers/${newCustomerId}`);
  if (fromCustomerId) {
    revalidatePath(`/customers/${fromCustomerId}`);
  }
  redirect(`/customers/${newCustomerId}`);
}

export async function lookupVinOwnershipAction(args: {
  vin: string;
  currentCustomerId: string;
  excludeMotorcycleId?: string | null;
}): Promise<VinOwnershipConflict | null> {
  const validation = validateOptionalVin(args.vin);
  if (!validation.ok || !validation.vin || !args.currentCustomerId) {
    return null;
  }

  try {
    return await lookupVinOwnershipConflict({
      vin: validation.vin,
      currentCustomerId: args.currentCustomerId,
      excludeMotorcycleId: args.excludeMotorcycleId,
    });
  } catch {
    return null;
  }
}

export type VinGarageLookupResult =
  | { kind: "not_found" }
  | {
      kind: "same_garage";
      motorcycle_id: string;
      bike_label: string;
    }
  | { kind: "other_owner"; conflict: VinOwnershipConflict };

/** Intake / garage VIN lookup: select existing bike or prompt transfer. */
export async function lookupVinInGarageAction(args: {
  vin: string;
  currentCustomerId: string;
}): Promise<VinGarageLookupResult> {
  const validation = validateOptionalVin(args.vin);
  if (!validation.ok || !validation.vin || !args.currentCustomerId) {
    return { kind: "not_found" };
  }

  try {
    const existing = await findMotorcycleByVin(validation.vin);
    if (!existing) return { kind: "not_found" };

    if (existing.customer_id === args.currentCustomerId) {
      return {
        kind: "same_garage",
        motorcycle_id: existing.motorcycle_id,
        bike_label: `${existing.year} ${existing.make} ${existing.model}`,
      };
    }

    return {
      kind: "other_owner",
      conflict: buildVinOwnershipConflict(existing),
    };
  } catch {
    return { kind: "not_found" };
  }
}

/**
 * Accept the VIN conflict prompt: transfer the existing bike into the current
 * customer's garage (no duplicate row).
 * Set `redirect: false` when staying on the current page (e.g. WO intake).
 */
export async function acceptVinTransferAction(args: {
  motorcycle_id: string;
  new_customer_id: string;
  redirect?: boolean;
}): Promise<{ error: string | null; motorcycle_id?: string }> {
  const shouldRedirect = args.redirect !== false;
  let fromCustomerId: string | null = null;
  try {
    const previous = await getMotorcycleById(args.motorcycle_id);
    fromCustomerId = previous?.customer_id ?? null;
    await transferMotorcycle({
      motorcycle_id: args.motorcycle_id,
      new_customer_id: args.new_customer_id,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/motorcycles");
  revalidatePath(`/motorcycles/${args.motorcycle_id}`);
  revalidatePath(`/customers/${args.new_customer_id}`);
  if (fromCustomerId) {
    revalidatePath(`/customers/${fromCustomerId}`);
  }

  if (shouldRedirect) {
    redirect(`/motorcycles/${args.motorcycle_id}`);
  }

  return { error: null, motorcycle_id: args.motorcycle_id };
}

export async function updateServiceInformationAction(
  motorcycleId: string,
  workOrderId: string | null,
  _prevState: MotorcycleFormState,
  formData: FormData
): Promise<MotorcycleFormState> {
  const input: ServiceInformationInput = {};
  for (const field of SERVICE_INFORMATION_FIELDS) {
    input[field] = String(formData.get(field) ?? "");
  }

  try {
    await updateMotorcycleServiceInformation(motorcycleId, input, {
      work_order_id: workOrderId,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/motorcycles/${motorcycleId}`);
  if (workOrderId) {
    revalidatePath(`/work_orders/${workOrderId}`);
  }
  return { error: null };
}
