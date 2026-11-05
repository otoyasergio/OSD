import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { isUndefinedTableError } from "@/lib/database/schemaCompat";
import type { WorkOrderStatus } from "@/lib/database/types";
import { stageContractFor, type StageContract } from "@/lib/accountability/stageContract";
import {
  declinedSafetyItems,
  loadFinalCheck,
  type FinalCheckView,
} from "@/lib/services/finalCheckRecord";
import { REQUIRED_PHOTO_CATEGORIES } from "@/lib/status/labels";
import { personName } from "@/lib/accountability/personName";
import {
  CHECKOUT_PHOTO_CATEGORIES,
  checkoutCoverageFromPhotos,
  checkoutEvidenceOverridden,
} from "@/lib/status/checkoutEvidence";

export type AccountabilitySnapshot = {
  advisorUserId: string | null;
  maximumAuthorizationCents: number | null;
  estimatedCompletion: string | null;
  keysNote: string;
  accessoriesNote: string;
  bikeSpot: string;
  authorizedApproverName: string;
  authorizedCollectorName: string;
  declinedSafetyAckSigner: string | null;
  declinedSafetyItems: string[];
  finalCheck: FinalCheckView | null;
  contract: StageContract;
};

export async function getWorkOrderAccountability(
  workOrderId: string
): Promise<AccountabilitySnapshot | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      status, estimated_completion, advisor_user_id, maximum_authorization_cents,
      keys_note, accessories_note, bike_spot, authorized_approver_name, authorized_collector_name,
      declined_safety_ack_signer, safety_required, safety_waived, safety_checked_at,
      checkout_evidence_override_at, checkout_evidence_override_by_user_id, checkout_evidence_override_reason,
      advisor:advisor_user_id ( first_name, last_name ),
      technician:primary_technician_id ( first_name, last_name )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error || !data) return null;

  const now = new Date().toISOString();
  const photoCategories = [...REQUIRED_PHOTO_CATEGORIES, ...CHECKOUT_PHOTO_CATEGORIES];
  const [
    finalCheck,
    items,
    ownerRes,
    photos,
    inspection,
    estimates,
    purchaseLines,
    jobs,
  ] = await Promise.all([
    loadFinalCheck(workOrderId).catch(() => null),
    declinedSafetyItems(workOrderId).catch(() => []),
    supabase
      .from("app_user")
      .select("first_name, last_name")
      .eq("role", "owner")
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("intake_photo")
      .select("category")
      .eq("work_order_id", workOrderId)
      .in("category", photoCategories),
    supabase
      .from("inspection")
      .select("completed_at")
      .eq("work_order_id", workOrderId)
      .maybeSingle(),
    supabase
      .from("estimate")
      .select("status")
      .eq("work_order_id", workOrderId)
      .eq("status", "confirmed")
      .limit(1),
    supabase
      .from("purchase_order_line")
      .select(
        `
          quantity_ordered,
          purchase_order:purchase_order_id ( expected_at ),
          requirement:requirement_id!inner ( quantity_received, job:job_id!inner ( work_order_id ) )
        `
      )
      .eq("requirement.job.work_order_id", workOrderId),
    supabase
      .from("job")
      .select("updated_at, started_at, created_at")
      .eq("work_order_id", workOrderId),
  ]);

  const photoRows = (photos.data ?? []) as Array<{ category: string }>;
  const intake = new Set(
    photoRows
      .filter((photo) =>
        (REQUIRED_PHOTO_CATEGORIES as readonly string[]).includes(photo.category)
      )
      .map((photo) => photo.category)
  );
  const checkout = checkoutCoverageFromPhotos(photoRows);
  const estimateRows =
    estimates.error && isUndefinedTableError(estimates.error, "estimate")
      ? []
      : ((estimates.data ?? []) as Array<{ status: string }>);
  const lineRows =
    purchaseLines.error &&
    isUndefinedTableError(purchaseLines.error, "purchase_order_line")
      ? []
      : ((purchaseLines.data ?? []) as Array<Record<string, unknown>>);
  let partsShort = false;
  let partsExpectedAt: string | null = null;
  for (const line of lineRows) {
    const requirement = line.requirement as {
      quantity_received?: number | null;
      job?: { work_order_id?: string } | null;
    } | null;
    const ordered = Number(line.quantity_ordered ?? 0);
    const received = Number(requirement?.quantity_received ?? 0);
    if (received < ordered) partsShort = true;
    const expected = (line.purchase_order as { expected_at?: string | null } | null)
      ?.expected_at;
    if (expected && (!partsExpectedAt || expected < partsExpectedAt))
      partsExpectedAt = expected;
  }
  const lastJobActivityAt =
    (
      (jobs.data ?? []) as Array<{
        updated_at?: string | null;
        started_at?: string | null;
        created_at?: string | null;
      }>
    )
      .flatMap((job) => [job.updated_at, job.started_at, job.created_at])
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  const status = data.status as WorkOrderStatus;
  const row = data as Record<string, unknown>;
  return {
    advisorUserId: (data.advisor_user_id as string | null) ?? null,
    maximumAuthorizationCents:
      data.maximum_authorization_cents == null
        ? null
        : Number(data.maximum_authorization_cents),
    estimatedCompletion: (data.estimated_completion as string | null) ?? null,
    keysNote: String(data.keys_note ?? ""),
    accessoriesNote: String(data.accessories_note ?? ""),
    bikeSpot: String(data.bike_spot ?? ""),
    authorizedApproverName: String(data.authorized_approver_name ?? ""),
    authorizedCollectorName: String(data.authorized_collector_name ?? ""),
    declinedSafetyAckSigner: (data.declined_safety_ack_signer as string | null) ?? null,
    declinedSafetyItems: items,
    finalCheck,
    contract: stageContractFor({
      status,
      advisorName: personName(data.advisor),
      technicianName: personName(data.technician),
      ownerName: personName(ownerRes.data),
      intakePhotoCount: intake.size,
      inspectionSigned: Boolean(inspection.data?.completed_at),
      hasConfirmedEstimate: estimateRows.some(
        (estimate) => estimate.status === "confirmed"
      ),
      hasMaximumAuthorization: data.maximum_authorization_cents != null,
      partsShort,
      partsExpectedAt,
      lastJobActivityAt,
      finalCheckRecorded: Boolean(finalCheck),
      safetyRequired: Boolean(data.safety_required) && !data.safety_waived,
      safetyChecked: Boolean(data.safety_checked_at),
      checkoutComplete:
        checkout.complete ||
        checkoutEvidenceOverridden({
          checkout_evidence_override_at: row.checkout_evidence_override_at as
            string | null,
          checkout_evidence_override_by_user_id:
            row.checkout_evidence_override_by_user_id as string | null,
          checkout_evidence_override_reason: row.checkout_evidence_override_reason as
            string | null,
        }),
      estimatedCompletion: (data.estimated_completion as string | null) ?? null,
      now,
    }),
  };
}
