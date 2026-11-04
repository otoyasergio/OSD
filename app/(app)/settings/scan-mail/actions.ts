"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { deleteScanMailbox } from "@/lib/email/scanMailbox";
import { canConnectShopMailbox } from "@/lib/permissions";

export async function disconnectScanMailboxAction(): Promise<void> {
  const user = await requireUser();
  if (!canConnectShopMailbox(user.role)) throw new Error("FORBIDDEN");
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  await deleteScanMailbox(user.active_location_id);
  revalidatePath("/settings/scan-mail");
}
