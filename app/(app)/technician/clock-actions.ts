"use server";

import { revalidatePath } from "next/cache";
import {
  clockIn,
  clockOut,
  endBreak,
  startBreak,
  submitMyTimesheetWeek,
} from "@/lib/services/timeClock";
import { toFormErrorMessage } from "@/lib/services/errors";

export type ClockFormState = { error: string | null };

function revalidateClock() {
  revalidatePath("/technician");
  revalidatePath("/technician/clock");
  revalidatePath("/settings/timesheets");
}

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
  revalidateClock();
  return { error: null };
}

export async function clockOutAction(
  _prev: ClockFormState,
  _formData: FormData
): Promise<ClockFormState> {
  void _prev;
  void _formData;
  try {
    await clockOut();
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateClock();
  return { error: null };
}

export async function startBreakAction(
  _prev: ClockFormState,
  _formData: FormData
): Promise<ClockFormState> {
  void _prev;
  void _formData;
  try {
    await startBreak("meal");
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateClock();
  return { error: null };
}

export async function endBreakAction(
  _prev: ClockFormState,
  _formData: FormData
): Promise<ClockFormState> {
  void _prev;
  void _formData;
  try {
    await endBreak();
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateClock();
  return { error: null };
}

export async function submitMyTimesheetAction(
  _prev: ClockFormState,
  formData: FormData
): Promise<ClockFormState> {
  try {
    const weekStart = String(formData.get("week_start_date") ?? "");
    await submitMyTimesheetWeek(weekStart);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateClock();
  return { error: null };
}
