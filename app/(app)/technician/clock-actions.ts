"use server";

import { revalidatePath } from "next/cache";
import { clockIn, clockOut } from "@/lib/services/timeClock";
import { toFormErrorMessage } from "@/lib/services/errors";

export type ClockFormState = { error: string | null };

export async function clockInAction(
  _prev: ClockFormState,
  formData: FormData
): Promise<ClockFormState> {
  try {
    const notes = String(formData.get("notes") ?? "");
    await clockIn(notes);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/technician");
  return { error: null };
}

export async function clockOutAction(
  _prev: ClockFormState,
  _formData: FormData
): Promise<ClockFormState> {
  try {
    await clockOut();
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/technician");
  return { error: null };
}
