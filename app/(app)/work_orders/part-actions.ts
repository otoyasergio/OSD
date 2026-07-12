"use server";

import { revalidatePath } from "next/cache";
import {
  addPartToJob,
  updatePartStatus,
  updatePartUnitPrice,
} from "@/lib/services/parts";
import { toFormErrorMessage } from "@/lib/services/errors";
import type { PartStatus } from "@/lib/database/types";
import { searchPartsCanadaCatalog } from "@/lib/services/partsCanadaCatalog";
import type { PartsCanadaSearchHit } from "@/lib/services/partsCanadaCatalog";

export type PartFormState = { error: string | null };

function revalidateParts(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/work_orders");
  revalidatePath("/parts");
}

function parseOptionalMoney(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parseOptionalInt(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? Math.round(value) : null;
}

export async function addPartAction(
  workOrderId: string,
  _prevState: PartFormState,
  formData: FormData
): Promise<PartFormState> {
  try {
    const quantityRaw = String(formData.get("quantity") ?? "1").trim();
    const quantity = Number(quantityRaw);
    const catalogSourceRaw = String(formData.get("catalog_source") ?? "").trim();
    const catalog_source =
      catalogSourceRaw === "parts_canada" || catalogSourceRaw === "manual"
        ? catalogSourceRaw
        : "manual";

    await addPartToJob(String(formData.get("job_id") ?? ""), {
      part_name: String(formData.get("part_name") ?? "").trim(),
      part_number: String(formData.get("part_number") ?? "").trim() || null,
      supplier: String(formData.get("supplier") ?? "").trim() || null,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      notes: String(formData.get("notes") ?? "").trim() || null,
      unit_price: parseOptionalMoney(formData.get("unit_price")),
      unit_cost: parseOptionalMoney(formData.get("unit_cost")),
      supplier_stock: parseOptionalInt(formData.get("supplier_stock")),
      catalog_source,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateParts(workOrderId);
  return { error: null };
}

export async function updatePartStatusAction(
  workOrderId: string,
  partId: string,
  _prevState: PartFormState,
  formData: FormData
): Promise<PartFormState> {
  try {
    await updatePartStatus(
      partId,
      String(formData.get("status") ?? "") as PartStatus
    );
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateParts(workOrderId);
  return { error: null };
}

export async function updatePartPriceAction(
  workOrderId: string,
  partId: string,
  _prevState: PartFormState,
  formData: FormData
): Promise<PartFormState> {
  try {
    await updatePartUnitPrice(
      partId,
      parseOptionalMoney(formData.get("unit_price"))
    );
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateParts(workOrderId);
  return { error: null };
}

export async function searchPartsCanadaAction(
  query: string
): Promise<PartsCanadaSearchHit[]> {
  try {
    return await searchPartsCanadaCatalog(query);
  } catch {
    return [];
  }
}
