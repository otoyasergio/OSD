"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import { runManualPartsCanadaSync } from "@/lib/services/partsCanadaCatalog";

export type PartsCanadaSyncFormState = {
  error: string | null;
  success: string | null;
};

export async function syncPartsCanadaAction(
  _prev: PartsCanadaSyncFormState,
  formData: FormData
): Promise<PartsCanadaSyncFormState> {
  void formData;
  try {
    const result = await runManualPartsCanadaSync();
    revalidatePath("/parts");
    return {
      error: null,
      success: `Synced ${result.row_count.toLocaleString()} Parts Canada items.`,
    };
  } catch (error) {
    return { error: toFormErrorMessage(error), success: null };
  }
}
