"use server";

import { revalidatePath } from "next/cache";
import {
  approveTimesheetWeek,
  createTimeClockCorrection,
  deleteTimeClockCorrection,
  rejectTimesheetWeek,
  reopenTimesheetWeek,
  updateTimeClockCorrection,
} from "@/lib/services/timeClock";
import { toFormErrorMessage } from "@/lib/services/errors";

export type TimesheetFormState = { error: string | null; ok?: boolean };

function revalidateTimesheets() {
  revalidatePath("/settings/timesheets");
  revalidatePath("/technician");
  revalidatePath("/technician/clock");
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
  _formData: FormData
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

export async function approveTimesheetAction(
  _prev: TimesheetFormState,
  formData: FormData
): Promise<TimesheetFormState> {
  try {
    await approveTimesheetWeek({
      user_id: String(formData.get("user_id") ?? ""),
      week_start_date: String(formData.get("week_start_date") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateTimesheets();
  return { error: null, ok: true };
}

export async function rejectTimesheetAction(
  _prev: TimesheetFormState,
  formData: FormData
): Promise<TimesheetFormState> {
  try {
    await rejectTimesheetWeek({
      user_id: String(formData.get("user_id") ?? ""),
      week_start_date: String(formData.get("week_start_date") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateTimesheets();
  return { error: null, ok: true };
}

export async function reopenTimesheetAction(
  _prev: TimesheetFormState,
  formData: FormData
): Promise<TimesheetFormState> {
  try {
    await reopenTimesheetWeek({
      user_id: String(formData.get("user_id") ?? ""),
      week_start_date: String(formData.get("week_start_date") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateTimesheets();
  return { error: null, ok: true };
}
