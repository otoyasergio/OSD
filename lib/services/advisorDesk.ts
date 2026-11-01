import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { WorkOrderStatus } from "@/lib/database/types";
import { canEditWorkOrder } from "@/lib/permissions";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { REQUIRED_PHOTO_CATEGORIES } from "@/lib/status/labels";
import {
  CHECKOUT_PHOTO_CATEGORIES,
  checkoutCoverageFromPhotos,
  checkoutEvidenceOverridden,
} from "@/lib/status/checkoutEvidence";
import {
  advisorQueueKinds,
  stageContractFor,
  type AdvisorQueueKind,
  type StageContract,
} from "@/lib/accountability/stageContract";
import { promiseAssumesFullDelivery } from "@/lib/purchasing/controls";
import { applyLegalParameterToWorkOrder } from "@/lib/services/legalParameters";
import {
  isUndefinedColumnError,
  isUndefinedTableError,
} from "@/lib/database/schemaCompat";

export type AdvisorOption = {
  user_id: string;
  first_name: string;
  last_name: string;
};

export type AdvisorQueueRow = {
  work_order_id: string;
  work_order_number: string;
  customer_name: string;
  bike_label: string;
  status: WorkOrderStatus;
  kinds: AdvisorQueueKind[];
  contract: StageContract;
};

const OPEN_EXCLUDE = '("completed","cancelled")';

function personName(
  row: { first_name?: string; last_name?: string } | null
): string | null {
  if (!row?.first_name && !row?.last_name) return null;
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
}

export async function listAdvisorsForActiveLocation(): Promise<AdvisorOption[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: memberships, error } = await supabase
    .from("user_location")
    .select("user_id")
    .eq("location_id", user.active_location_id!);
  if (error) throw error;
  const ids = (memberships ?? []).map((row: { user_id: string }) => row.user_id);
  if (ids.length === 0) return [];
  const { data, error: userError } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name")
    .in("user_id", ids)
    .in("role", ["service_advisor", "manager", "owner"])
    .eq("status", "active")
    .order("last_name");
  if (userError) throw userError;
  return (data ?? []) as AdvisorOption[];
}

export async function listAdvisorQueue(): Promise<AdvisorQueueRow[]> {
  const user = await requireUser();
  if (!canEditWorkOrder(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const locationId = user.active_location_id!;
  const now = new Date().toISOString();

  const { data: orders, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id, work_order_number, status, estimated_completion, ready_for_pickup_at,
      maximum_authorization_cents, safety_required, safety_waived, safety_checked_at,
      checkout_evidence_override_at, checkout_evidence_override_by_user_id, checkout_evidence_override_reason,
      advisor:advisor_user_id ( first_name, last_name ),
      technician:primary_technician_id ( first_name, last_name ),
      customer:customer_id ( first_name, last_name ),
      motorcycle:motorcycle_id ( year, make, model )
    `
    )
    .eq("location_id", locationId)
    .not("status", "in", OPEN_EXCLUDE)
    .order("estimated_completion", { ascending: true, nullsFirst: false })
    .limit(200);
  if (error) {
    if (isUndefinedColumnError(error, "advisor_user_id")) {
      throw new Error("ACCOUNTABILITY_NOT_MIGRATED");
    }
    throw error;
  }

  const rows = (orders ?? []) as Array<Record<string, unknown>>;
  const ids = rows.map((row) => String(row.work_order_id));
  if (ids.length === 0) return [];

  const [
    messages,
    estimates,
    purchaseLines,
    photos,
    inspections,
    checks,
    jobs,
    ownerRes,
  ] = await Promise.all([
    supabase
      .from("communication_log")
      .select("work_order_id, direction, created_at")
      .in("work_order_id", ids)
      .order("created_at", { ascending: false }),
    supabase
      .from("estimate")
      .select("work_order_id, status")
      .in("work_order_id", ids)
      .in("status", ["presented", "confirmed"]),
    supabase
      .from("purchase_order_line")
      .select(
        `
          quantity_ordered,
          purchase_order:purchase_order_id ( location_id, expected_at ),
          requirement:requirement_id (
            quantity_received,
            job:job_id ( work_order_id )
          )
        `
      )
      .limit(500),
    supabase
      .from("intake_photo")
      .select("work_order_id, category")
      .in("work_order_id", ids)
      .in("category", [...REQUIRED_PHOTO_CATEGORIES, ...CHECKOUT_PHOTO_CATEGORIES]),
    supabase
      .from("inspection")
      .select("work_order_id, completed_at")
      .in("work_order_id", ids),
    supabase.from("final_check").select("work_order_id").in("work_order_id", ids),
    supabase
      .from("job")
      .select("work_order_id, updated_at, started_at, created_at")
      .in("work_order_id", ids),
    supabase
      .from("app_user")
      .select("first_name, last_name")
      .eq("role", "owner")
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  if (messages.error) throw messages.error;
  if (photos.error) throw photos.error;
  if (inspections.error) throw inspections.error;
  const estimateRows = estimates.error
    ? []
    : ((estimates.data ?? []) as Array<{ work_order_id: string; status: string }>);
  if (estimates.error && !isUndefinedTableError(estimates.error, "estimate")) {
    throw estimates.error;
  }
  const poLines = purchaseLines.error
    ? []
    : ((purchaseLines.data ?? []) as Array<Record<string, unknown>>);
  if (
    purchaseLines.error &&
    !isUndefinedTableError(purchaseLines.error, "purchase_order_line")
  ) {
    throw purchaseLines.error;
  }
  const finalChecks = checks.error
    ? []
    : ((checks.data ?? []) as Array<{ work_order_id: string }>);
  if (checks.error && !isUndefinedTableError(checks.error, "final_check"))
    throw checks.error;

  const ownerName = personName(
    ownerRes.data as { first_name: string; last_name: string } | null
  );

  const lastMessage = new Map<
    string,
    { inbound: string | null; outbound: string | null }
  >();
  for (const message of (messages.data ?? []) as Array<{
    work_order_id: string;
    direction: string;
    created_at: string;
  }>) {
    const slot = lastMessage.get(message.work_order_id) ?? {
      inbound: null,
      outbound: null,
    };
    if (message.direction === "inbound" && !slot.inbound)
      slot.inbound = message.created_at;
    if (message.direction === "outbound" && !slot.outbound)
      slot.outbound = message.created_at;
    lastMessage.set(message.work_order_id, slot);
  }

  const confirmed = new Set(
    estimateRows
      .filter((row) => row.status === "confirmed")
      .map((row) => row.work_order_id)
  );
  const presentedOpen = new Set(
    estimateRows
      .filter((row) => row.status === "presented")
      .map((row) => row.work_order_id)
  );

  const partsByWo = new Map<string, { short: boolean; expectedAt: string | null }>();
  for (const line of poLines) {
    const po = line.purchase_order as {
      location_id?: string;
      expected_at?: string | null;
    } | null;
    if (!po || po.location_id !== locationId) continue;
    const requirement = line.requirement as {
      quantity_received?: number | null;
      job?: { work_order_id?: string } | null;
    } | null;
    const workOrderId = requirement?.job?.work_order_id;
    if (!workOrderId) continue;
    const ordered = Number(line.quantity_ordered ?? 0);
    const received = Number(requirement?.quantity_received ?? 0);
    const current = partsByWo.get(workOrderId) ?? { short: false, expectedAt: null };
    if (received < ordered) current.short = true;
    if (po.expected_at && (!current.expectedAt || po.expected_at < current.expectedAt)) {
      current.expectedAt = po.expected_at;
    }
    partsByWo.set(workOrderId, current);
  }

  if (jobs.error) throw jobs.error;

  const photoCounts = new Map<string, Set<string>>();
  const checkoutByWo = new Map<string, Array<{ category: string }>>();
  const intakeCategories = new Set<string>(REQUIRED_PHOTO_CATEGORIES);
  for (const photo of (photos.data ?? []) as Array<{
    work_order_id: string;
    category: string;
  }>) {
    if (intakeCategories.has(photo.category)) {
      const set = photoCounts.get(photo.work_order_id) ?? new Set<string>();
      set.add(photo.category);
      photoCounts.set(photo.work_order_id, set);
    } else {
      const list = checkoutByWo.get(photo.work_order_id) ?? [];
      list.push(photo);
      checkoutByWo.set(photo.work_order_id, list);
    }
  }
  const jobActivity = new Map<string, string>();
  for (const job of (jobs.data ?? []) as Array<{
    work_order_id: string;
    updated_at?: string | null;
    started_at?: string | null;
    created_at?: string | null;
  }>) {
    const at = [job.updated_at, job.started_at, job.created_at].filter(
      (value): value is string => Boolean(value)
    );
    const latest = at.sort().at(-1);
    if (!latest) continue;
    const previous = jobActivity.get(job.work_order_id);
    if (!previous || latest > previous) jobActivity.set(job.work_order_id, latest);
  }
  const signed = new Set(
    (
      (inspections.data ?? []) as Array<{
        work_order_id: string;
        completed_at: string | null;
      }>
    )
      .filter((row) => row.completed_at)
      .map((row) => row.work_order_id)
  );
  const checked = new Set(finalChecks.map((row) => row.work_order_id));

  const queue: AdvisorQueueRow[] = [];
  for (const row of rows) {
    const id = String(row.work_order_id);
    const status = row.status as WorkOrderStatus;
    const advisor = personName(
      row.advisor as { first_name: string; last_name: string } | null
    );
    const technician = personName(
      row.technician as { first_name: string; last_name: string } | null
    );
    const customer = row.customer as { first_name?: string; last_name?: string } | null;
    const bike = row.motorcycle as {
      year?: number;
      make?: string;
      model?: string;
    } | null;
    const parts = partsByWo.get(id) ?? { short: false, expectedAt: null };
    const messagesFor = lastMessage.get(id) ?? { inbound: null, outbound: null };
    const safetyRequired = Boolean(row.safety_required) && !row.safety_waived;
    const kinds = advisorQueueKinds({
      status,
      lastInboundAt: messagesFor.inbound,
      lastOutboundAt: messagesFor.outbound,
      partsExpectedAt: parts.expectedAt,
      partsShort: parts.short,
      estimatedCompletion: (row.estimated_completion as string | null) ?? null,
      readyForPickupAt: (row.ready_for_pickup_at as string | null) ?? null,
      hasPresentedUnconfirmedEstimate: presentedOpen.has(id) && !confirmed.has(id),
      now,
    });
    if (kinds.length === 0 && advisor) continue;

    queue.push({
      work_order_id: id,
      work_order_number: String(row.work_order_number ?? ""),
      customer_name: personName(customer) ?? "Customer",
      bike_label: bike
        ? `${bike.year ?? ""} ${bike.make ?? ""} ${bike.model ?? ""}`.trim()
        : "Motorcycle",
      status,
      kinds,
      contract: stageContractFor({
        status,
        advisorName: advisor,
        technicianName: technician,
        ownerName: ownerName,
        intakePhotoCount: photoCounts.get(id)?.size ?? 0,
        inspectionSigned: signed.has(id),
        hasConfirmedEstimate: confirmed.has(id),
        hasMaximumAuthorization: row.maximum_authorization_cents != null,
        partsShort: parts.short,
        partsExpectedAt: parts.expectedAt,
        lastJobActivityAt: jobActivity.get(id) ?? null,
        finalCheckRecorded: checked.has(id),
        safetyRequired,
        safetyChecked: Boolean(row.safety_checked_at),
        checkoutComplete:
          checkoutCoverageFromPhotos(checkoutByWo.get(id) ?? []).complete ||
          checkoutEvidenceOverridden({
            checkout_evidence_override_at: row.checkout_evidence_override_at as
              string | null,
            checkout_evidence_override_by_user_id:
              row.checkout_evidence_override_by_user_id as string | null,
            checkout_evidence_override_reason: row.checkout_evidence_override_reason as
              string | null,
          }),
        estimatedCompletion: (row.estimated_completion as string | null) ?? null,
        now,
      }),
    });
  }
  return queue;
}

async function requireEditableWorkOrder(workOrderId: string) {
  const user = await requireUser();
  if (!canEditWorkOrder(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, status, estimated_completion")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("WORK_ORDER_NOT_FOUND");
  if (data.location_id !== user.active_location_id) throw new Error("FOREIGN_LOCATION");
  if (data.status === "completed" || data.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }
  return { user, supabase, workOrder: data };
}

export async function assignAdvisor(
  workOrderId: string,
  advisorUserId: string
): Promise<void> {
  const { user, supabase } = await requireEditableWorkOrder(workOrderId);
  const { error } = await supabase
    .from("work_order")
    .update({ advisor_user_id: advisorUserId, updated_at: new Date().toISOString() })
    .eq("work_order_id", workOrderId);
  if (error) throw error;
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "advisor_assigned",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Advisor of record assigned",
    new_value: { advisor_user_id: advisorUserId },
  });
}

export async function recordMaximumAuthorization(
  workOrderId: string,
  amountCents: number
): Promise<void> {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("MAXIMUM_AUTHORIZATION_INVALID");
  }
  const { user, supabase } = await requireEditableWorkOrder(workOrderId);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("work_order")
    .update({
      maximum_authorization_cents: amountCents,
      maximum_authorized_at: now,
      maximum_authorized_by_user_id: user.user_id,
      estimate_declined_at: now,
      updated_at: now,
    })
    .eq("work_order_id", workOrderId);
  if (error) throw error;
  await applyLegalParameterToWorkOrder(workOrderId);
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "maximum_authorization_recorded",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Customer declined a written estimate and authorized a maximum",
    new_value: { maximum_authorization_cents: amountCents },
  });
}

export async function recordPromiseDate(
  workOrderId: string,
  estimatedCompletion: string
): Promise<void> {
  const when = new Date(estimatedCompletion);
  if (Number.isNaN(when.getTime())) throw new Error("PROMISE_DATE_INVALID");
  const { user, supabase } = await requireEditableWorkOrder(workOrderId);
  const { data: lines, error: lineError } = await supabase
    .from("purchase_order_line")
    .select(
      `
      quantity_ordered,
      requirement:requirement_id ( quantity_received, job:job_id ( work_order_id ) )
    `
    )
    .limit(200);
  if (lineError && !isUndefinedTableError(lineError, "purchase_order_line"))
    throw lineError;
  const relevant = ((lines ?? []) as Array<Record<string, unknown>>)
    .filter((line) => {
      const requirement = line.requirement as { job?: { work_order_id?: string } } | null;
      return requirement?.job?.work_order_id === workOrderId;
    })
    .map((line) => {
      const requirement = line.requirement as { quantity_received?: number | null };
      return {
        ordered: Number(line.quantity_ordered ?? 0),
        received: Number(requirement?.quantity_received ?? 0),
      };
    });
  if (promiseAssumesFullDelivery({ hasPromise: true, lines: relevant })) {
    throw new Error("PROMISE_ASSUMES_FULL_DELIVERY");
  }
  const { error } = await supabase
    .from("work_order")
    .update({
      estimated_completion: when.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);
  if (error) throw error;
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "promise_date_recorded",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Promise date recorded",
    new_value: { estimated_completion: when.toISOString() },
  });
}

export type HandoverInput = {
  keysNote: string;
  accessoriesNote: string;
  bikeSpot: string;
  authorizedApproverName: string;
  authorizedCollectorName: string;
};

export async function saveHandover(
  workOrderId: string,
  input: HandoverInput
): Promise<void> {
  const { user, supabase } = await requireEditableWorkOrder(workOrderId);
  const { error } = await supabase
    .from("work_order")
    .update({
      keys_note: input.keysNote.trim() || null,
      accessories_note: input.accessoriesNote.trim() || null,
      bike_spot: input.bikeSpot.trim() || null,
      authorized_approver_name: input.authorizedApproverName.trim() || null,
      authorized_collector_name: input.authorizedCollectorName.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);
  if (error && isUndefinedColumnError(error, "keys_note")) {
    throw new Error("ACCOUNTABILITY_NOT_MIGRATED");
  }
  if (error) throw error;
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "handover_recorded",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Custody and handover details recorded",
  });
}
