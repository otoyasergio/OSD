"use server";

import { revalidatePath } from "next/cache";
import { publishAgreementTemplate } from "@/lib/services/contracts";
import { toFormErrorMessage } from "@/lib/services/errors";

export type ContractTemplateFormState = { error: string | null; success?: boolean };

function parseInitialFields(raw: string): string[] {
  return raw
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

export async function publishContractTemplateAction(
  _prevState: ContractTemplateFormState,
  formData: FormData
): Promise<ContractTemplateFormState> {
  try {
    const version = String(formData.get("version") ?? "").trim();
    await publishAgreementTemplate({
      title: String(formData.get("title") ?? "").trim(),
      body_html: String(formData.get("body_html") ?? "").trim(),
      initial_fields: parseInitialFields(String(formData.get("initial_fields") ?? "")),
      version: version || undefined,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath("/settings/contract_template");
  revalidatePath("/settings");
  return { error: null, success: true };
}
