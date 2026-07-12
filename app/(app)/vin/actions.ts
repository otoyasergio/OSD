"use server";

import { decodeVin, type VinDecodeResult } from "@/lib/vin/decode";
import { requireUser } from "@/lib/auth/session";

export async function decodeVinAction(vin: string): Promise<VinDecodeResult> {
  await requireUser();
  return decodeVin(vin);
}
