"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  assignAdvisor,
  recordMaximumAuthorization,
  recordPromiseDate,
  saveHandover,
} from "@/lib/services/advisorDesk";
import {
  acknowledgeDeclinedSafety,
  saveFinalCheck,
} from "@/lib/services/finalCheckRecord";
import type { RoadTestResult } from "@/lib/quality/finalCheck";
import { parseShopLocalDateTimeInput } from "@/lib/datetime/format";
import { parseDollarsToCents } from "@/lib/billing/stages";

export type AccountabilityFormState = { error: string | null; saved: boolean };

export async function assignAdvisorAction(
  workOrderId: string,
  _previous: AccountabilityFormState,
  formData: FormData
): Promise<AccountabilityFormState> {
  try {
    await assignAdvisor(workOrderId, String(formData.get("advisor_user_id") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/advisor");
  return { error: null, saved: true };
}

export async function maximumAuthorizationAction(
  workOrderId: string,
  _previous: AccountabilityFormState,
  formData: FormData
): Promise<AccountabilityFormState> {
  try {
    const cents = parseDollarsToCents(String(formData.get("maximum_dollars") ?? ""));
    if (cents == null) throw new Error("MAXIMUM_AUTHORIZATION_INVALID");
    await recordMaximumAuthorization(workOrderId, cents);
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }
  revalidatePath(`/work_orders/${workOrderId}`);
  return { error: null, saved: true };
}

export async function promiseDateAction(
  workOrderId: string,
  _previous: AccountabilityFormState,
  formData: FormData
): Promise<AccountabilityFormState> {
  try {
    const when = parseShopLocalDateTimeInput(String(formData.get("promise_date") ?? ""));
    if (!when) throw new Error("PROMISE_DATE_INVALID");
    await recordPromiseDate(workOrderId, when.toISOString());
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/advisor");
  return { error: null, saved: true };
}

export async function handoverAction(
  workOrderId: string,
  _previous: AccountabilityFormState,
  formData: FormData
): Promise<AccountabilityFormState> {
  try {
    await saveHandover(workOrderId, {
      keysNote: String(formData.get("keys_note") ?? ""),
      accessoriesNote: String(formData.get("accessories_note") ?? ""),
      bikeSpot: String(formData.get("bike_spot") ?? ""),
      authorizedApproverName: String(formData.get("authorized_approver_name") ?? ""),
      authorizedCollectorName: String(formData.get("authorized_collector_name") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }
  revalidatePath(`/work_orders/${workOrderId}`);
  return { error: null, saved: true };
}

export async function finalCheckAction(
  workOrderId: string,
  _previous: AccountabilityFormState,
  formData: FormData
): Promise<AccountabilityFormState> {
  try {
    const mileageRaw = String(formData.get("mileage_out") ?? "").trim();
    await saveFinalCheck(workOrderId, {
      technicianUserId: String(formData.get("technician_user_id") ?? ""),
      verifierUserId: String(formData.get("verifier_user_id") ?? ""),
      roadTestResult: String(
        formData.get("road_test_result") ?? "not_performed"
      ) as RoadTestResult,
      mileageOut: mileageRaw ? Number(mileageRaw) : null,
      leaks: String(formData.get("leaks") ?? ""),
      warningLights: String(formData.get("warning_lights") ?? ""),
      unresolvedDefects: String(formData.get("unresolved_defects") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }
  revalidatePath(`/work_orders/${workOrderId}`);
  return { error: null, saved: true };
}

export async function declinedSafetyAckAction(
  workOrderId: string,
  _previous: AccountabilityFormState,
  formData: FormData
): Promise<AccountabilityFormState> {
  try {
    await acknowledgeDeclinedSafety(
      workOrderId,
      String(formData.get("signer_name") ?? "")
    );
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }
  revalidatePath(`/work_orders/${workOrderId}`);
  return { error: null, saved: true };
}
