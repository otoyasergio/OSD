"use server";

import { revalidatePath } from "next/cache";
import {
  createTimeClockCorrection,
  deleteTimeClockCorrection,
  updateTimeClockCorrection,
} from "@/lib/services/timeClock";
import { toFormErrorMessage } from "@/lib/services/errors";

export type TimesheetFormState = { error: string | null; ok?: boolean };

function revalidateTimesheets() {
  revalidatePath("/settings/timesheets");
  revalidatePath("/technician");
}

export async function createPunchAction(
  _prev: TimesheetFormState,
  formData: FormData
): Promise<TimesheetFormState> {
  try {
    await createTimeClockCorrection({
      user_id: String(formData.get("user_id") ?? ""),
      clock_in_at: String(formData.get("clock_in_at") ?? ""),
      clock_out_at: String(formData.get("clock_out_at") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateTimesheets();
  return { error: null, ok: true };
}

export async function updatePunchAction(
  entryId: string,
  _prev: TimesheetFormState,
  formData: FormData
): Promise<TimesheetFormState> {
  try {
    const clockOutRaw = String(formData.get("clock_out_at") ?? "").trim();
    await updateTimeClockCorrection({
      entry_id: entryId,
      clock_in_at: String(formData.get("clock_in_at") ?? ""),
      clock_out_at: clockOutRaw || null,
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateTimesheets();
  return { error: null, ok: true };
}

export async function deletePunchAction(
  entryId: string,
  _prev: TimesheetFormState,
  _formData: FormData // required by useActionState bind signature
): Promise<TimesheetFormState> {
  void _prev;
  void _formData;
  try {
    await deleteTimeClockCorrection(entryId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateTimesheets();
  return { error: null, ok: true };
}
