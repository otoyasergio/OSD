"use server";

import { revalidatePath } from "next/cache";
import {
  addStaffNote,
  upsertStaffEmploymentRecord,
  uploadStaffDocument,
  voidStaffDocument,
  voidStaffNote,
} from "@/lib/services/staffProfiles";
import {
  clearStaffTimeClockPin,
  setStaffTimeClockPin,
} from "@/lib/services/timeClockKiosk";
import { toFormErrorMessage } from "@/lib/services/errors";

export type StaffFormState = { error: string | null; success?: string | null };

function revalidateStaff(userId: string) {
  revalidatePath(`/settings/staff/${userId}`);
  revalidatePath("/settings/users");
}

export async function updateEmploymentAction(
  userId: string,
  _prev: StaffFormState,
  formData: FormData
): Promise<StaffFormState> {
  try {
    const dayHoursRaw = String(formData.get("regular_work_day_hours") ?? "").trim();
    const weekHoursRaw = String(formData.get("regular_work_week_hours") ?? "").trim();
    const payTypeRaw = String(formData.get("pay_type") ?? "").trim();
    await upsertStaffEmploymentRecord(userId, {
      legal_name: String(formData.get("legal_name") ?? ""),
      home_address: String(formData.get("home_address") ?? ""),
      employment_start_date: String(formData.get("employment_start_date") ?? ""),
      date_of_birth: String(formData.get("date_of_birth") ?? ""),
      employment_end_date: String(formData.get("employment_end_date") ?? ""),
      job_title: String(formData.get("job_title") ?? ""),
      regular_work_day_hours: dayHoursRaw ? Number(dayHoursRaw) : null,
      regular_work_week_hours: weekHoursRaw ? Number(weekHoursRaw) : null,
      pay_type: payTypeRaw === "hourly" || payTypeRaw === "salary" ? payTypeRaw : null,
      emergency_contact_name: String(formData.get("emergency_contact_name") ?? ""),
      emergency_contact_phone: String(formData.get("emergency_contact_phone") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateStaff(userId);
  return { error: null, success: "Employment record saved." };
}

export async function setPinAction(
  userId: string,
  _prev: StaffFormState,
  formData: FormData
): Promise<StaffFormState> {
  try {
    const pin = String(formData.get("pin") ?? "").trim();
    await setStaffTimeClockPin(userId, pin);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateStaff(userId);
  return { error: null, success: "Time clock PIN saved." };
}

export async function clearPinAction(userId: string): Promise<void> {
  await clearStaffTimeClockPin(userId);
  revalidateStaff(userId);
}

export async function addNoteAction(
  userId: string,
  _prev: StaffFormState,
  formData: FormData
): Promise<StaffFormState> {
  try {
    await addStaffNote(userId, String(formData.get("body") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateStaff(userId);
  return { error: null, success: "Note added." };
}

export async function voidNoteAction(userId: string, noteId: string): Promise<void> {
  await voidStaffNote(noteId);
  revalidateStaff(userId);
}

export async function uploadDocumentAction(
  userId: string,
  _prev: StaffFormState,
  formData: FormData
): Promise<StaffFormState> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("DOCUMENT_REQUIRED");
    await uploadStaffDocument(userId, {
      title: String(formData.get("title") ?? ""),
      category: String(formData.get("category") ?? ""),
      file,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateStaff(userId);
  return { error: null, success: "Document uploaded." };
}

export async function voidDocumentAction(
  userId: string,
  documentId: string
): Promise<void> {
  await voidStaffDocument(documentId);
  revalidateStaff(userId);
}
