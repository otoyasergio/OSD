"use server";

import { revalidatePath } from "next/cache";
import { recordBikeReading, saveBikeLinkSchedule } from "@/lib/services/bikeLink";
import { toFormErrorMessage } from "@/lib/services/errors";

export type BikeLinkFormState = { error: string | null };

export async function recordBikeReadingAction(
  motorcycleId: string,
  _prev: BikeLinkFormState,
  formData: FormData
): Promise<BikeLinkFormState> {
  try {
    await recordBikeReading(motorcycleId, {
      source: String(formData.get("source") ?? ""),
      placeName: String(formData.get("place_name") ?? ""),
      odometer: String(formData.get("odometer") ?? ""),
      batteryVolts: String(formData.get("battery_volts") ?? ""),
      faultCodes: String(formData.get("fault_codes") ?? ""),
      recordedAt: String(formData.get("recorded_at") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/motorcycles/${motorcycleId}`);
  return { error: null };
}

export async function saveBikeLinkScheduleAction(
  motorcycleId: string,
  _prev: BikeLinkFormState,
  formData: FormData
): Promise<BikeLinkFormState> {
  try {
    await saveBikeLinkSchedule(motorcycleId, {
      intervalDistance: String(formData.get("interval_distance") ?? ""),
      intervalDays: String(formData.get("interval_days") ?? ""),
      lastServiceOdometer: String(formData.get("last_service_odometer") ?? ""),
      lastServiceOn: String(formData.get("last_service_on") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/motorcycles/${motorcycleId}`);
  return { error: null };
}
