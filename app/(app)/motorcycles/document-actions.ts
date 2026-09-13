"use server";

import { revalidatePath } from "next/cache";
import {
  deleteMotorcycleDocument,
  uploadMotorcycleDocument,
} from "@/lib/services/motorcycleDocuments";
import { toFormErrorMessage } from "@/lib/services/errors";

export type MotorcycleDocumentActionState = { error: string | null };

export async function uploadMotorcycleDocumentAction(
  motorcycleId: string,
  formData: FormData
): Promise<MotorcycleDocumentActionState> {
  try {
    const files = formData.getAll("file").filter((value) => value instanceof File);
    if (files.length === 0) {
      throw new Error("DOCUMENT_REQUIRED");
    }
    const title = String(formData.get("title") ?? "");
    const notes = String(formData.get("notes") ?? "");
    for (const file of files) {
      await uploadMotorcycleDocument(motorcycleId, {
        title,
        notes: notes || null,
        file,
      });
    }
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/motorcycles/${motorcycleId}`);
  return { error: null };
}

export async function deleteMotorcycleDocumentAction(
  documentId: string
): Promise<MotorcycleDocumentActionState> {
  let motorcycleId: string;
  try {
    const result = await deleteMotorcycleDocument(documentId);
    motorcycleId = result.motorcycle_id;
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/motorcycles/${motorcycleId}`);
  return { error: null };
}
