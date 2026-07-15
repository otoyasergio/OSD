"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import {
  assignTechnicianToWorkOrder,
  createWorkOrder,
  getLastRecordedMileageForMotorcycle,
  setPrimaryTechnician,
  type LastRecordedMileage,
} from "@/lib/services/workOrders";
import { listIntakePhotos, uploadIntakePhoto } from "@/lib/services/photos";
import { toFormErrorMessage } from "@/lib/services/errors";
import { requireUser } from "@/lib/auth/session";
import type { PhotoCategory } from "@/lib/database/types";
import { readServiceLinesFromFormData } from "@/lib/forms/serviceLines";
import { CREATE_INTAKE_PHOTO_SLOTS, PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { parseShopLocalDateTimeInput } from "@/lib/datetime/format";

export type WorkOrderFormState = {
  error: string | null;
  /** Set when the WO was created but intake uploads are incomplete. */
  workOrderId?: string | null;
  workOrderNumber?: string | null;
  missingCategories?: PhotoCategory[];
};

const REQUIRED_INTAKE_CATEGORIES = CREATE_INTAKE_PHOTO_SLOTS.map((slot) => slot.category);

export async function getLastRecordedMileageAction(
  motorcycleId: string
): Promise<LastRecordedMileage | null> {
  if (!motorcycleId.trim()) return null;
  return getLastRecordedMileageForMotorcycle(motorcycleId);
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

  return createWorkOrder({
    motorcycle_id: String(formData.get("motorcycle_id") ?? ""),
    location_id: user.active_location_id!,
    // Square assigns invoice_number when staff sync/publish from Billing
    external_invoice_number: null,
    mileage: readRequiredMileage(formData),
    mileage_unit: formData.get("mileage_unit") === "mi" ? "mi" : "km",
    estimated_completion: readEstimatedCompletion(formData),
    internal_notes: String(formData.get("internal_notes") ?? ""),
    primary_technician_id: primaryTech || null,
    service_ids: serviceIds,
    service_lines: serviceLines,
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
    revalidatePath(`/work_orders/${result.work_order_id}`);
    return {
      error: null,
      workOrderId: result.work_order_id,
      workOrderNumber: result.work_order_number,
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
      return { error: toFormErrorMessage(error) };
    }

    const failed = await uploadIntakeBatch(workOrderId, files);
    revalidatePath("/work_orders");
    revalidatePath("/dashboard");

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
  const existing = await listIntakePhotos(workOrderId);
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
  revalidatePath("/technician");
  revalidatePath("/technician/docket");
  return { error: null };
}
