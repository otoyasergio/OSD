"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import {
  applyWixNumberToExistingWorkOrder,
  assignTechnicianToWorkOrder,
  createWorkOrder,
  getLastRecordedMileageForMotorcycle,
  setPrimaryTechnician,
  type LastRecordedMileage,
} from "@/lib/services/workOrders";
import { wixInvoicesEnabled } from "@/lib/config/features";
import {
  acknowledgeInvoiceFailure,
  attachInvoiceToWorkOrder,
  clearLegacyInvoiceHold,
  getOpenWixIntakeHold,
  prepareIntakeInvoice,
  WixIntakeBlockedError,
} from "@/lib/services/wixInvoices";
import { normalizeEnteredWixInvoiceNumber } from "@/lib/wix/invoiceRules";
import { listIntakePhotos, uploadIntakePhoto } from "@/lib/services/photos";
import { toFormErrorMessage } from "@/lib/services/errors";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { PhotoCategory } from "@/lib/database/types";
import {
  readServiceLinesFromFormData,
  type BikePackageFitment,
} from "@/lib/forms/serviceLines";
import { CREATE_INTAKE_PHOTO_SLOTS, PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { parseShopLocalDateTimeInput } from "@/lib/datetime/format";

export type WorkOrderFormState = {
  error: string | null;
  /** Set when the WO was created but intake uploads are incomplete. */
  workOrderId?: string | null;
  workOrderNumber?: string | null;
  missingCategories?: PhotoCategory[];
  /** Staff must acknowledge a Wix failure before intake can continue. */
  wixAcknowledgementId?: string | null;
  /** Revision staff saw. A later failure bumps this and ignores a stale acknowledge. */
  wixHoldRevision?: number | null;
};

const REQUIRED_INTAKE_CATEGORIES = CREATE_INTAKE_PHOTO_SLOTS.map((slot) => slot.category);

export async function getLastRecordedMileageAction(
  motorcycleId: string
): Promise<LastRecordedMileage | null> {
  if (!motorcycleId.trim()) return null;
  return getLastRecordedMileageForMotorcycle(motorcycleId);
}

export async function getMotorcyclePackageFitmentAction(
  motorcycleId: string
): Promise<BikePackageFitment | null> {
  if (!motorcycleId.trim()) return null;
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("motorcycle_service_information")
    .select("oil_filter, oil_type, spark_plugs, air_filter")
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    oil_filter: data.oil_filter,
    oil_type: data.oil_type,
    spark_plugs: data.spark_plugs,
    air_filter: data.air_filter,
  };
}

function readRequiredMileage(formData: FormData): number {
  const key = "mileage";
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw || !/^\d+$/.test(raw)) return Number.NaN;
  return Number(raw);
}

function readEstimatedCompletion(formData: FormData): string {
  const raw = String(formData.get("estimated_completion") ?? "").trim();
  if (!raw) return "";
  // datetime-local lacks timezone; interpret as America/Toronto wall time.
  const date = parseShopLocalDateTimeInput(raw);
  if (!date) return "";
  return date.toISOString();
}

function readIntakeFile(formData: FormData, category: PhotoCategory): File | null {
  const file = formData.get(`intake_${category}`);
  if (!(file instanceof File) || file.size === 0) return null;
  return file;
}

function collectRequiredIntakeFiles(
  formData: FormData,
  categories: PhotoCategory[] = REQUIRED_INTAKE_CATEGORIES
): { files: Map<PhotoCategory, File>; missing: PhotoCategory[] } {
  const files = new Map<PhotoCategory, File>();
  const missing: PhotoCategory[] = [];

  for (const category of categories) {
    const file = readIntakeFile(formData, category);
    if (file) files.set(category, file);
    else missing.push(category);
  }

  return { files, missing };
}

async function uploadIntakeBatch(
  workOrderId: string,
  files: Map<PhotoCategory, File>
): Promise<PhotoCategory[]> {
  const failed: PhotoCategory[] = [];

  for (const [category, file] of files) {
    try {
      await uploadIntakePhoto(workOrderId, { category, file });
    } catch {
      failed.push(category);
    }
  }

  return failed;
}

function intakePartialError(
  workOrderId: string,
  workOrderNumber: string,
  missing: PhotoCategory[]
): WorkOrderFormState {
  const labels = missing.map((c) => PHOTO_CATEGORY_LABELS[c] ?? c).join(", ");
  return {
    error: `${toFormErrorMessage(new Error("INTAKE_PHOTOS_PARTIAL"))} Missing: ${labels}.`,
    workOrderId,
    workOrderNumber,
    missingCategories: missing,
  };
}

async function createWorkOrderFromFormData(formData: FormData): Promise<{
  work_order_id: string;
  work_order_number: string;
}> {
  const user = await requireUser();
  const serviceIds = formData
    .getAll("service_ids")
    .map((value) => String(value))
    .filter(Boolean);

  const primaryTech = String(formData.get("primary_technician_id") ?? "").trim();

  const serviceLines = readServiceLinesFromFormData(formData, serviceIds);
  if (serviceLines.some((line) => line.standard_price === null)) {
    throw new Error("SERVICE_PRICE_REQUIRED");
  }

  const mileage = readRequiredMileage(formData);
  const mileageUnit = formData.get("mileage_unit") === "mi" ? "mi" : "km";
  const shared = {
    motorcycle_id: String(formData.get("motorcycle_id") ?? ""),
    location_id: user.active_location_id!,
    external_invoice_number: null,
    mileage,
    mileage_unit: mileageUnit as "km" | "mi",
    estimated_completion: readEstimatedCompletion(formData),
    internal_notes: String(formData.get("internal_notes") ?? ""),
    primary_technician_id: primaryTech || null,
    service_ids: serviceIds,
    service_lines: serviceLines,
  };

  if (wixInvoicesEnabled()) {
    const prepared = await prepareIntakeInvoice({
      customerId: String(formData.get("customer_id") ?? ""),
      motorcycleId: shared.motorcycle_id,
      mileage,
      mileageUnit,
      serviceLines: serviceLines.map((line) => ({
        serviceId: line.service_id,
        name: "Service",
        price: line.standard_price ?? 0,
      })),
      technicianName: null,
      technicianUserId: primaryTech || null,
      forceWixAttempt: String(formData.get("force_wix_attempt") ?? "") === "1",
    });
    const created = prepared.replacesBookingStub
      ? await applyWixNumberToExistingWorkOrder(prepared.workOrderId, {
          ...shared,
          work_order_number: prepared.displayNumber,
        })
      : await createWorkOrder({
          ...shared,
          work_order_number: prepared.displayNumber,
          work_order_id: prepared.workOrderId,
        });
    await attachInvoiceToWorkOrder(prepared.wixInvoiceId, created.work_order_id);
    return created;
  }

  return createWorkOrder({
    ...shared,
    work_order_number: String(formData.get("work_order_number") ?? "").trim(),
  });
}

/**
 * Create the work order only (no photo bytes). Used by the wizard so each
 * intake photo can be uploaded in a separate request under body-size limits.
 */
export async function createWorkOrderOnlyAction(
  _prevState: WorkOrderFormState,
  formData: FormData
): Promise<WorkOrderFormState> {
  try {
    const result = await createWorkOrderFromFormData(formData);
    revalidatePath("/work_orders");
    revalidatePath("/dashboard");
    revalidatePath("/control-center");
    revalidatePath("/technician");
    revalidatePath("/technician/docket");
    revalidatePath(`/work_orders/${result.work_order_id}`);
    return {
      error: null,
      workOrderId: result.work_order_id,
      workOrderNumber: result.work_order_number,
    };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof WixIntakeBlockedError) {
      return {
        error: error.message,
        wixAcknowledgementId: error.acknowledgementId,
        wixHoldRevision: error.holdRevision,
      };
    }
    return { error: toFormErrorMessage(error) };
  }
}

/**
 * Acknowledge the Wix error staff are looking at, then create the work order.
 * One request keeps a second Acknowledge from stamping the failure this retry stores.
 */
export async function retryAcknowledgedWixIntakeAction(
  acknowledgementId: string,
  holdRevision: number,
  errorText: string,
  formData: FormData
): Promise<WorkOrderFormState> {
  try {
    await acknowledgeInvoiceFailure(acknowledgementId, { holdRevision, errorText });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: toFormErrorMessage(error) };
  }
  return createWorkOrderOnlyAction({ error: null }, formData);
}

export async function loadOpenWixIntakeHoldAction(
  customerId: string,
  motorcycleId: string
): Promise<WorkOrderFormState & { legacyNumberEntry?: boolean }> {
  try {
    const hold = await getOpenWixIntakeHold(customerId, motorcycleId);
    if (!hold) {
      return {
        error: null,
        wixAcknowledgementId: null,
        wixHoldRevision: null,
        legacyNumberEntry: false,
      };
    }
    return {
      error: hold.errorText,
      wixAcknowledgementId: hold.acknowledgementId,
      wixHoldRevision: hold.holdRevision,
      legacyNumberEntry: hold.legacyNumberEntry,
    };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: toFormErrorMessage(error), legacyNumberEntry: false };
  }
}

/**
 * Save the visit with the invoice number staff copied from Wix.
 * Used only while this site is still on the legacy invoices service.
 */
export async function createWorkOrderWithEnteredWixNumberAction(
  formData: FormData
): Promise<WorkOrderFormState> {
  try {
    if (!wixInvoicesEnabled()) {
      return { error: toFormErrorMessage(new Error("WIX_INVOICE_NUMBER_NOT_ALLOWED")) };
    }
    const number = normalizeEnteredWixInvoiceNumber(
      String(formData.get("work_order_number") ?? "")
    );
    if (!number) {
      return { error: toFormErrorMessage(new Error("WIX_INVOICE_NUMBER_REQUIRED")) };
    }
    const customerId = String(formData.get("customer_id") ?? "");
    const motorcycleId = String(formData.get("motorcycle_id") ?? "");
    const hold = await getOpenWixIntakeHold(customerId, motorcycleId);
    if (!hold?.legacyNumberEntry) {
      return { error: toFormErrorMessage(new Error("WIX_INVOICE_NUMBER_NOT_ALLOWED")) };
    }

    const user = await requireUser();
    const serviceIds = formData
      .getAll("service_ids")
      .map((value) => String(value))
      .filter(Boolean);
    const primaryTech = String(formData.get("primary_technician_id") ?? "").trim();
    const serviceLines = readServiceLinesFromFormData(formData, serviceIds);
    if (serviceLines.some((line) => line.standard_price === null)) {
      throw new Error("SERVICE_PRICE_REQUIRED");
    }
    const shared = {
      motorcycle_id: motorcycleId,
      location_id: user.active_location_id!,
      external_invoice_number: null,
      mileage: readRequiredMileage(formData),
      mileage_unit: (formData.get("mileage_unit") === "mi" ? "mi" : "km") as "km" | "mi",
      estimated_completion: readEstimatedCompletion(formData),
      internal_notes: String(formData.get("internal_notes") ?? ""),
      primary_technician_id: primaryTech || null,
      service_ids: serviceIds,
      service_lines: serviceLines,
      work_order_number: number,
    };

    let existingId: string | null = null;
    if (hold.pendingWorkOrderId) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("work_order")
        .select("work_order_id")
        .eq("work_order_id", hold.pendingWorkOrderId)
        .maybeSingle();
      if (error) throw error;
      if (data?.work_order_id) existingId = String(data.work_order_id);
    }

    const created = existingId
      ? await applyWixNumberToExistingWorkOrder(existingId, shared)
      : await createWorkOrder({
          ...shared,
          ...(hold.pendingWorkOrderId ? { work_order_id: hold.pendingWorkOrderId } : {}),
        });
    await clearLegacyInvoiceHold(hold.acknowledgementId);
    revalidatePath("/work_orders");
    revalidatePath("/dashboard");
    revalidatePath("/control-center");
    revalidatePath("/technician");
    revalidatePath("/technician/docket");
    revalidatePath(`/work_orders/${created.work_order_id}`);
    return {
      error: null,
      workOrderId: created.work_order_id,
      workOrderNumber: created.work_order_number,
    };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: toFormErrorMessage(error) };
  }
}

/**
 * Create a work order and upload the six required intake photos in one flow.
 * Prefer the wizard's create-then-upload path for large camera photos.
 * If create succeeds but some uploads fail, returns a recovery state instead of redirecting.
 */
export async function createWorkOrderWithIntakePhotosAction(
  _prevState: WorkOrderFormState,
  formData: FormData
): Promise<WorkOrderFormState> {
  try {
    const { files, missing } = collectRequiredIntakeFiles(formData);
    if (missing.length > 0) {
      return {
        error: toFormErrorMessage(new Error("INTAKE_PHOTOS_REQUIRED")),
      };
    }

    let workOrderId: string;
    let workOrderNumber: string;

    try {
      const result = await createWorkOrderFromFormData(formData);
      workOrderId = result.work_order_id;
      workOrderNumber = result.work_order_number;
    } catch (error) {
      if (error instanceof WixIntakeBlockedError) {
        return {
          error: error.message,
          wixAcknowledgementId: error.acknowledgementId,
          wixHoldRevision: error.holdRevision,
        };
      }
      return { error: toFormErrorMessage(error) };
    }

    const failed = await uploadIntakeBatch(workOrderId, files);
    revalidatePath("/work_orders");
    revalidatePath("/dashboard");
    revalidatePath("/control-center");
    revalidatePath("/technician");
    revalidatePath("/technician/docket");

    if (failed.length > 0) {
      revalidatePath(`/work_orders/${workOrderId}`);
      return intakePartialError(workOrderId, workOrderNumber, failed);
    }

    revalidatePath(`/work_orders/${workOrderId}`);
    redirect(`/work_orders/${workOrderId}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: toFormErrorMessage(error) };
  }
}

async function missingRequiredIntakeCategories(
  workOrderId: string
): Promise<PhotoCategory[]> {
  const existing = await listIntakePhotos(workOrderId, { sign: "none" });
  const covered = new Set(existing.map((photo) => photo.category));
  return REQUIRED_INTAKE_CATEGORIES.filter((category) => !covered.has(category));
}

/**
 * Finish missing required intake photos after a partial create failure.
 * Re-checks the database so already-uploaded categories are not required again.
 */
export async function completeIntakePhotosAction(
  workOrderId: string,
  _prevState: WorkOrderFormState,
  formData: FormData
): Promise<WorkOrderFormState> {
  try {
    if (!workOrderId) {
      return {
        error: toFormErrorMessage(new Error("WORK_ORDER_NOT_FOUND")),
      };
    }

    let stillMissing: PhotoCategory[];
    try {
      stillMissing = await missingRequiredIntakeCategories(workOrderId);
    } catch (error) {
      return {
        error: toFormErrorMessage(error),
        workOrderId,
      };
    }

    if (stillMissing.length === 0) {
      revalidatePath(`/work_orders/${workOrderId}`);
      redirect(`/work_orders/${workOrderId}`);
    }

    const { files, missing } = collectRequiredIntakeFiles(formData, stillMissing);
    if (missing.length > 0) {
      return {
        error: toFormErrorMessage(new Error("INTAKE_PHOTOS_REQUIRED")),
        workOrderId,
        missingCategories: stillMissing,
      };
    }

    const failed = await uploadIntakeBatch(workOrderId, files);
    revalidatePath("/work_orders");
    revalidatePath("/dashboard");
    revalidatePath("/control-center");
    revalidatePath(`/work_orders/${workOrderId}`);

    if (failed.length > 0) {
      const remaining = await missingRequiredIntakeCategories(workOrderId).catch(
        () => failed
      );
      return intakePartialError(workOrderId, "", remaining);
    }

    redirect(`/work_orders/${workOrderId}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return {
      error: toFormErrorMessage(error),
      workOrderId,
    };
  }
}
/** @deprecated Prefer createWorkOrderWithIntakePhotosAction for new creates. */
export async function createWorkOrderAction(
  _prevState: WorkOrderFormState,
  formData: FormData
): Promise<WorkOrderFormState> {
  return createWorkOrderWithIntakePhotosAction(_prevState, formData);
}

export async function assignTechnicianAction(
  workOrderId: string,
  _prevState: WorkOrderFormState,
  formData: FormData
): Promise<WorkOrderFormState> {
  try {
    await assignTechnicianToWorkOrder(
      workOrderId,
      String(formData.get("technician_id") ?? "")
    );
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/dashboard");
  revalidatePath("/control-center");
  revalidatePath("/technician");
  revalidatePath("/technician/docket");
  return { error: null };
}

export async function setPrimaryTechnicianAction(
  workOrderId: string,
  _prevState: WorkOrderFormState,
  formData: FormData
): Promise<WorkOrderFormState> {
  try {
    const technicianId = String(formData.get("technician_id") ?? "").trim();
    await setPrimaryTechnician(workOrderId, technicianId || null);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/dashboard");
  revalidatePath("/control-center");
  revalidatePath("/technician");
  revalidatePath("/technician/docket");
  return { error: null };
}
