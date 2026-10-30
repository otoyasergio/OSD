"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { deleteShopMailbox } from "@/lib/email/mailbox";
import { canConnectShopMailbox } from "@/lib/permissions";

export async function disconnectShopMailboxAction(): Promise<void> {
  const user = await requireUser();
  if (!canConnectShopMailbox(user.role)) throw new Error("FORBIDDEN");
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  await deleteShopMailbox(user.active_location_id);
  revalidatePath("/settings/email");
}
