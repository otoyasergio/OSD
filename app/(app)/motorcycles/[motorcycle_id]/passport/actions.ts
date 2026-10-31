"use server";

import { revalidatePath } from "next/cache";
import { createPassportShare, revokePassportShare } from "@/lib/services/passportShare";
import { toFormErrorMessage } from "@/lib/services/errors";
import { publishVehiclePassport } from "@/lib/services/vehiclePassport";

export type PassportActionState = {
  error: string | null;
  message: string | null;
  shareUrl: string | null;
  shareExpiresAt: string | null;
};

const EMPTY_PASSPORT_ACTION_STATE: PassportActionState = {
  error: null,
  message: null,
  shareUrl: null,
  shareExpiresAt: null,
};

function revalidatePassport(motorcycleId: string) {
  revalidatePath(`/motorcycles/${motorcycleId}`);
  revalidatePath(`/motorcycles/${motorcycleId}/passport`);
}

export async function publishVehiclePassportAction(
  motorcycleId: string,
  _previousState: PassportActionState,
  _formData: FormData
): Promise<PassportActionState> {
  try {
    const published = await publishVehiclePassport(motorcycleId);
    revalidatePassport(motorcycleId);
    return {
      error: null,
      message: `${published.passportNumber} version ${published.reportVersion} published.`,
      shareUrl: null,
      shareExpiresAt: null,
    };
  } catch (error) {
    return {
      ...EMPTY_PASSPORT_ACTION_STATE,
      error: toFormErrorMessage(error),
    };
  }
}

export async function createPassportShareAction(
  motorcycleId: string,
  snapshotId: string,
  _previousState: PassportActionState,
  _formData: FormData
): Promise<PassportActionState> {
  try {
    const share = await createPassportShare(snapshotId);
    revalidatePassport(motorcycleId);
    return {
      error: null,
      message: "A new seven-day link was created. Any earlier active link was revoked.",
      shareUrl: share.url,
      shareExpiresAt: share.expiresAt,
    };
  } catch (error) {
    return {
      ...EMPTY_PASSPORT_ACTION_STATE,
      error: toFormErrorMessage(error),
    };
  }
}

export async function revokePassportShareAction(
  motorcycleId: string,
  _previousState: PassportActionState,
  formData: FormData
): Promise<PassportActionState> {
  try {
    const shareId = String(formData.get("share_id") ?? "").trim();
    if (!shareId) throw new Error("PASSPORT_SHARE_NOT_FOUND");
    await revokePassportShare(shareId);
    revalidatePassport(motorcycleId);
    return {
      error: null,
      message: "Passport link revoked.",
      shareUrl: null,
      shareExpiresAt: null,
    };
  } catch (error) {
    return {
      ...EMPTY_PASSPORT_ACTION_STATE,
      error: toFormErrorMessage(error),
    };
  }
}
