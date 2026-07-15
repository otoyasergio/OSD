"use server";

import { revalidatePath } from "next/cache";
import { moveJobInDocket } from "@/lib/services/technicianDocket";
import type { DocketMoveDirection } from "@/lib/technician/docketOrder";

export async function reorderDocketJobAction(formData: FormData): Promise<void> {
  const jobId = String(formData.get("job") ?? "");
  const dirRaw = String(formData.get("dir") ?? "");
  if (!jobId) return;
  const direction: DocketMoveDirection =
    dirRaw === "up" || dirRaw === "top" ? dirRaw : "down";

  await moveJobInDocket(jobId, direction);

  revalidatePath("/technician/docket");
  revalidatePath("/technician");
}
