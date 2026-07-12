"use server";

import { revalidatePath } from "next/cache";
import { addTechnicianNote } from "@/lib/services/notes";
import { toFormErrorMessage } from "@/lib/services/errors";
import type { TechnicianNoteType } from "@/lib/database/types";

export type NoteFormState = { error: string | null };

function revalidateNotes(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
}

export async function addTechnicianNoteAction(
  workOrderId: string,
  _prevState: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  try {
    const jobRaw = String(formData.get("job_id") ?? "").trim();
    await addTechnicianNote(workOrderId, {
      note: String(formData.get("note") ?? ""),
      note_type: String(
        formData.get("note_type") ?? "general"
      ) as TechnicianNoteType,
      job_id: jobRaw || null,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateNotes(workOrderId);
  return { error: null };
}
