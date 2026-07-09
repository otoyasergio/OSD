"use server";

import { revalidatePath } from "next/cache";
import {
  createLocation,
  setLocationUsers,
  updateLocation,
} from "@/lib/services/locations";
import { toFormErrorMessage } from "@/lib/services/errors";

export type LocationFormState = { error: string | null };

export async function createLocationAction(
  _prevState: LocationFormState,
  formData: FormData
): Promise<LocationFormState> {
  try {
    await createLocation({
      name: String(formData.get("name") ?? ""),
      code: String(formData.get("code") ?? ""),
      status: "active",
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/settings/locations");
  return { error: null };
}

export async function updateLocationAction(
  locationId: string,
  _prevState: LocationFormState,
  formData: FormData
): Promise<LocationFormState> {
  try {
    await updateLocation(locationId, {
      name: String(formData.get("name") ?? ""),
      code: String(formData.get("code") ?? ""),
      status:
        String(formData.get("status") ?? "active") === "inactive"
          ? "inactive"
          : "active",
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/settings/locations");
  return { error: null };
}

export async function setLocationUsersAction(
  locationId: string,
  _prevState: LocationFormState,
  formData: FormData
): Promise<LocationFormState> {
  try {
    const userIds = formData
      .getAll("user_ids")
      .map((value) => String(value))
      .filter(Boolean);
    await setLocationUsers(locationId, userIds);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/settings/locations");
  revalidatePath("/settings/users");
  return { error: null };
}
