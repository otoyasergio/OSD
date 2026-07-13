"use server";

import { revalidatePath } from "next/cache";
import {
  deleteCustomerDocument,
  uploadCustomerDocument,
} from "@/lib/services/customerDocuments";
import { toFormErrorMessage } from "@/lib/services/errors";

export type DocumentActionState = { error: string | null };

export async function uploadCustomerDocumentAction(
  customerId: string,
  formData: FormData
): Promise<DocumentActionState> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("DOCUMENT_REQUIRED");
    }
    await uploadCustomerDocument(customerId, {
      title: String(formData.get("title") ?? ""),
      file,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}

export async function deleteCustomerDocumentAction(
  documentId: string
): Promise<DocumentActionState> {
  let customerId: string;
  try {
    const result = await deleteCustomerDocument(documentId);
    customerId = result.customer_id;
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}
