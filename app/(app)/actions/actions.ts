"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import { dismissClientAction, sendClientActionSms } from "@/lib/services/clientActions";

export async function sendClientActionAction(input: {
  reason: string;
  cycleKey: string;
  body: string;
}): Promise<{ error: string | null }> {
  try {
    await sendClientActionSms(input);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/actions");
  return { error: null };
}

export async function dismissClientActionAction(input: {
  reason: string;
  cycleKey: string;
}): Promise<{ error: string | null }> {
  try {
    await dismissClientAction(input);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/actions");
  return { error: null };
}
