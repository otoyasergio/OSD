import type { DbClient } from "@/lib/database/types";
import { signStoragePaths } from "@/lib/photos/signedUrls";
import {
  CHECKOUT_PHOTO_CATEGORIES,
  checkoutCoverageFromPhotos,
  checkoutEvidenceOverridden,
  type CheckoutCoverage,
} from "@/lib/status/checkoutEvidence";

export type CommittedCheckoutPhoto = {
  photo_id: string;
  category: string;
  storage_path?: string | null;
  thumb_storage_path?: string | null;
  photo_url?: string | null;
  signed_url?: string | null;
  thumb_url?: string | null;
};

export type CheckoutEvidenceState = CheckoutCoverage & {
  required: boolean;
  overridden: boolean;
  override: {
    at: string | null;
    byUserId: string | null;
    reason: string | null;
  };
};

export type WorkOrderCheckoutFields = {
  checkout_evidence_required?: boolean | null;
  checkout_evidence_override_at?: string | null;
  checkout_evidence_override_by_user_id?: string | null;
  checkout_evidence_override_reason?: string | null;
};

/** Only committed intake_photo rows count — never local queue state. */
export async function loadCommittedCheckoutPhotos(
  supabase: DbClient,
  workOrderId: string
): Promise<CommittedCheckoutPhoto[]> {
  const { data, error } = await supabase
    .from("intake_photo")
    .select("photo_id, category, storage_path, thumb_storage_path, photo_url")
    .eq("work_order_id", workOrderId)
    .in("category", [...CHECKOUT_PHOTO_CATEGORIES]);
  if (error) throw error;
  const rows = (data ?? []) as CommittedCheckoutPhoto[];
  const signed = await signStoragePaths(
    supabase,
    rows.flatMap((row) =>
      row.thumb_storage_path
        ? [row.storage_path ?? "", row.thumb_storage_path]
        : [row.storage_path ?? ""]
    )
  );
  return rows.map((row) => {
    const signed_url = signed.get(row.storage_path ?? "") ?? row.photo_url ?? null;
    return {
      ...row,
      signed_url,
      thumb_url:
        (row.thumb_storage_path ? signed.get(row.thumb_storage_path) : null) ??
        signed_url,
    };
  });
}

/** Only committed intake_photo rows count — never local queue state. */
export async function loadCommittedCheckoutCoverage(
  supabase: DbClient,
  workOrderId: string
): Promise<CheckoutCoverage> {
  const { data, error } = await supabase
    .from("intake_photo")
    .select("category")
    .eq("work_order_id", workOrderId)
    .in("category", [...CHECKOUT_PHOTO_CATEGORIES]);
  if (error) throw error;
  return checkoutCoverageFromPhotos(data ?? []);
}

export async function loadCheckoutEvidenceState(
  supabase: DbClient,
  workOrderId: string,
  workOrder?: WorkOrderCheckoutFields | null
): Promise<CheckoutEvidenceState> {
  let fields = workOrder;
  if (!fields) {
    const { data, error } = await supabase
      .from("work_order")
      .select(
        "checkout_evidence_required, checkout_evidence_override_at, checkout_evidence_override_by_user_id, checkout_evidence_override_reason"
      )
      .eq("work_order_id", workOrderId)
      .maybeSingle();
    if (error) throw error;
    fields = data;
  }

  const coverage = await loadCommittedCheckoutCoverage(supabase, workOrderId);
  const override = {
    at: fields?.checkout_evidence_override_at ?? null,
    byUserId: fields?.checkout_evidence_override_by_user_id ?? null,
    reason: fields?.checkout_evidence_override_reason ?? null,
  };
  return {
    ...coverage,
    required: Boolean(fields?.checkout_evidence_required),
    overridden: checkoutEvidenceOverridden({
      checkout_evidence_override_at: override.at,
      checkout_evidence_override_by_user_id: override.byUserId,
      checkout_evidence_override_reason: override.reason,
    }),
    override,
  };
}

export function checkoutPickupGateInput(state: CheckoutEvidenceState) {
  return {
    checkoutEvidenceRequired: state.required,
    checkoutEvidenceComplete: state.complete,
    checkoutEvidenceOverridden: state.overridden,
  };
}
