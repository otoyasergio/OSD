import "server-only";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type {
  JobStatus,
  PartRequirementState,
  WorkOrderStatus,
} from "@/lib/database/types";
import type { MileageUnit } from "@/lib/mileage/format";
import {
  buildPassportDraft,
  type PassportDraft,
  type PassportDraftInput,
} from "@/lib/passport/buildDraft";
import {
  collectPassportSensitiveValues,
  generatePassportNumber,
  PASSPORT_WORK_ORDER_SELECT,
} from "@/lib/passport/source";
import { canEditWorkOrder } from "@/lib/permissions";

type RawPassportPart = {
  description: string;
  part_number: string | null;
  quantity_installed: number;
  state: PartRequirementState;
};

type RawPassportJob = {
  job_id: string;
  service_name_snapshot: string;
  status: JobStatus;
  job_part_requirement: RawPassportPart[] | null;
};

type RawPassportWorkOrder = {
  work_order_id: string;
  customer_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  completed_at: string | null;
  mileage: number | null;
  mileage_unit: MileageUnit;
  location: { name: string } | null;
  job: RawPassportJob[] | null;
};

type RawPassportCustomer = {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
};

type RawPassport = {
  passport_id: string;
  passport_number: string;
  status: "active" | "suspended";
};

type RawPassportVersion = {
  version: number;
};

export type VehiclePassportDraft = PassportDraft & {
  motorcycleId: string;
  passportId: string | null;
  passportNumber: string;
  reportVersion: number;
};

export type PublishedVehiclePassport = {
  snapshotId: string;
  passportId: string;
  passportNumber: string;
  reportVersion: number;
  publishedAt: string;
};

type DraftOptions = {
  issuedAt?: string;
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function loadVehiclePassportDraft(
  motorcycleId: string,
  options: DraftOptions = {}
): Promise<VehiclePassportDraft> {
  const user = await requireUser();
  if (!canEditWorkOrder(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const [motorcycleResult, workOrdersResult, passportResult] = await Promise.all([
    supabase
      .from("motorcycle")
      .select("motorcycle_id, year, make, model, vin, colour")
      .eq("motorcycle_id", motorcycleId)
      .maybeSingle(),
    supabase
      .from("work_order")
      .select(PASSPORT_WORK_ORDER_SELECT)
      .eq("motorcycle_id", motorcycleId)
      .eq("status", "completed")
      .order("completed_at", { ascending: true })
      .limit(500),
    supabase
      .from("vehicle_passport")
      .select("passport_id, passport_number, status")
      .eq("motorcycle_id", motorcycleId)
      .maybeSingle(),
  ]);

  if (motorcycleResult.error) throw motorcycleResult.error;
  if (!motorcycleResult.data) throw new Error("MOTORCYCLE_NOT_FOUND");
  if (workOrdersResult.error) throw workOrdersResult.error;
  if (passportResult.error) throw passportResult.error;

  const passport = passportResult.data as RawPassport | null;
  if (passport?.status === "suspended") throw new Error("PASSPORT_SUSPENDED");

  const workOrders = (workOrdersResult.data ?? []) as unknown as RawPassportWorkOrder[];
  const customerIds = unique(workOrders.map((row) => row.customer_id));
  let customers: RawPassportCustomer[] = [];
  if (customerIds.length > 0) {
    const customerResult = await supabase
      .from("customer")
      .select("first_name, last_name, phone, email, address")
      .in("customer_id", customerIds);
    if (customerResult.error) throw customerResult.error;
    customers = (customerResult.data ?? []) as RawPassportCustomer[];
  }

  let latestVersion = 0;
  if (passport) {
    const versionResult = await supabase
      .from("vehicle_passport_snapshot")
      .select("version")
      .eq("passport_id", passport.passport_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionResult.error) throw versionResult.error;
    latestVersion = (versionResult.data as RawPassportVersion | null)?.version ?? 0;
  }

  const passportNumber = passport?.passport_number ?? generatePassportNumber();
  const reportVersion = latestVersion + 1;
  const source: PassportDraftInput = {
    passportNumber,
    reportVersion,
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    motorcycle: {
      year: motorcycleResult.data.year,
      make: motorcycleResult.data.make,
      model: motorcycleResult.data.model,
      vin: motorcycleResult.data.vin,
      colour: motorcycleResult.data.colour,
    },
    workOrders: workOrders.map((row) => ({
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      status: row.status,
      completed_at: row.completed_at,
      mileage: row.mileage == null ? null : Number(row.mileage),
      mileage_unit: row.mileage_unit,
      location_name: row.location?.name ?? "Toronto",
      jobs: (row.job ?? []).map((job) => ({
        job_id: job.job_id,
        service_name_snapshot: job.service_name_snapshot,
        status: job.status,
        part_requirements: (job.job_part_requirement ?? []).map((part) => ({
          description: part.description,
          part_number: part.part_number,
          quantity_installed: Number(part.quantity_installed),
          state: part.state,
        })),
      })),
    })),
    sensitiveValues: collectPassportSensitiveValues(customers),
  };
  const draft = buildPassportDraft(source);

  return {
    ...draft,
    motorcycleId,
    passportId: passport?.passport_id ?? null,
    passportNumber,
    reportVersion,
  };
}

export async function previewVehiclePassport(
  motorcycleId: string
): Promise<VehiclePassportDraft> {
  return loadVehiclePassportDraft(motorcycleId);
}

export async function publishVehiclePassport(
  motorcycleId: string
): Promise<PublishedVehiclePassport> {
  const draft = await loadVehiclePassportDraft(motorcycleId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_vehicle_passport_snapshot", {
    p_motorcycle_id: motorcycleId,
    p_passport_number: draft.passportNumber,
    p_expected_version: draft.reportVersion,
    p_payload: draft.payload,
    p_payload_sha256: draft.payloadSha256,
    p_coverage_through: draft.payload.coverage_through,
    p_work_order_ids: draft.sourceWorkOrderIds,
  });
  if (error) throw error;

  const result = (Array.isArray(data) ? data[0] : data) as {
    published_snapshot_id: string;
    published_passport_id: string;
    published_passport_number: string;
    published_version: number;
    published_at: string;
  } | null;
  if (!result) throw new Error("PASSPORT_PUBLISH_FAILED");

  return {
    snapshotId: result.published_snapshot_id,
    passportId: result.published_passport_id,
    passportNumber: result.published_passport_number,
    reportVersion: result.published_version,
    publishedAt: result.published_at,
  };
}
