import "server-only";

import { requireUser } from "@/lib/auth/session";
import { createPassportAdminClient } from "@/lib/database/supabase-admin";
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
} from "@/lib/passport/source";
import { assertPassportReviewCurrent, type PassportReview } from "@/lib/passport/review";
import { canManageVehiclePassport } from "@/lib/permissions";
import { toRpcErrorCode } from "@/lib/services/errors";

type RawPassportPart = {
  description: string;
  part_number: string | null;
  quantity_installed: number;
  state: PartRequirementState;
};

type RawPassportJob = {
  job_id: string;
  public_service_name: string;
  status: JobStatus;
  part_requirements: RawPassportPart[];
};

type RawPassportWorkOrder = {
  work_order_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  completed_at: string | null;
  mileage: number | null;
  mileage_unit: MileageUnit;
  location_name: string;
  jobs: RawPassportJob[];
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

type RawPassportSource = {
  motorcycle: {
    year: number;
    make: string;
    model: string;
    vin: string | null;
    colour: string | null;
  };
  work_orders: RawPassportWorkOrder[];
  customers: RawPassportCustomer[];
};

export type VehiclePassportDraft = PassportDraft & {
  motorcycleId: string;
  passportId: string | null;
  passportNumber: string;
  reportVersion: number;
  sourceSha256: string;
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
  passportNumber?: string;
  reportVersion?: number;
};

async function loadVehiclePassportDraft(
  motorcycleId: string,
  options: DraftOptions = {}
): Promise<VehiclePassportDraft> {
  const user = await requireUser();
  if (!canManageVehiclePassport(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const [sourceResult, passportResult] = await Promise.all([
    supabase.rpc("read_vehicle_passport_source", {
      p_motorcycle_id: motorcycleId,
    }),
    supabase
      .from("vehicle_passport")
      .select("passport_id, passport_number, status")
      .eq("motorcycle_id", motorcycleId)
      .maybeSingle(),
  ]);

  if (sourceResult.error) {
    throw new Error(toRpcErrorCode(sourceResult.error));
  }
  if (passportResult.error) throw passportResult.error;
  const sourceRow = (
    Array.isArray(sourceResult.data) ? sourceResult.data[0] : sourceResult.data
  ) as { source: RawPassportSource; source_sha256: string } | null;
  if (!sourceRow?.source?.motorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");

  const passport = passportResult.data as RawPassport | null;
  if (passport?.status === "suspended") throw new Error("PASSPORT_SUSPENDED");

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

  if (
    passport &&
    options.passportNumber &&
    options.passportNumber !== passport.passport_number
  ) {
    throw new Error("PASSPORT_PREVIEW_STALE");
  }
  const passportNumber =
    passport?.passport_number ?? options.passportNumber ?? generatePassportNumber();
  const reportVersion = latestVersion + 1;
  if (options.reportVersion != null && options.reportVersion !== reportVersion) {
    throw new Error("PASSPORT_PREVIEW_STALE");
  }
  const source: PassportDraftInput = {
    passportNumber,
    reportVersion,
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    motorcycle: {
      year: sourceRow.source.motorcycle.year,
      make: sourceRow.source.motorcycle.make,
      model: sourceRow.source.motorcycle.model,
      vin: sourceRow.source.motorcycle.vin,
      colour: sourceRow.source.motorcycle.colour,
    },
    workOrders: sourceRow.source.work_orders.map((row) => ({
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      status: row.status,
      completed_at: row.completed_at,
      mileage: row.mileage == null ? null : Number(row.mileage),
      mileage_unit: row.mileage_unit,
      location_name: row.location_name,
      jobs: row.jobs.map((job) => ({
        job_id: job.job_id,
        public_service_name: job.public_service_name,
        status: job.status,
        part_requirements: job.part_requirements.map((part) => ({
          description: part.description,
          part_number: part.part_number,
          quantity_installed: Number(part.quantity_installed),
          state: part.state,
        })),
      })),
    })),
    sensitiveValues: collectPassportSensitiveValues(sourceRow.source.customers),
  };
  const draft = buildPassportDraft(source);

  return {
    ...draft,
    motorcycleId,
    passportId: passport?.passport_id ?? null,
    passportNumber,
    reportVersion,
    sourceSha256: sourceRow.source_sha256,
  };
}

export async function previewVehiclePassport(
  motorcycleId: string
): Promise<VehiclePassportDraft> {
  return loadVehiclePassportDraft(motorcycleId);
}

export async function publishVehiclePassport(
  motorcycleId: string,
  review: PassportReview
): Promise<PublishedVehiclePassport> {
  const actor = await requireUser();
  if (!canManageVehiclePassport(actor.role)) throw new Error("FORBIDDEN");
  const draft = await loadVehiclePassportDraft(motorcycleId, {
    issuedAt: review.issuedAt,
    passportNumber: review.passportNumber,
    reportVersion: review.reportVersion,
  });
  assertPassportReviewCurrent(review, draft);
  const admin = createPassportAdminClient();
  const { data, error } = await admin.rpc("publish_vehicle_passport_snapshot", {
    p_actor_user_id: actor.user_id,
    p_motorcycle_id: motorcycleId,
    p_passport_number: draft.passportNumber,
    p_expected_version: draft.reportVersion,
    p_payload: draft.payload,
    p_payload_sha256: draft.payloadSha256,
    p_source_sha256: draft.sourceSha256,
    p_coverage_through: draft.payload.coverage_through,
    p_work_order_ids: draft.sourceWorkOrderIds,
  });
  if (error) throw new Error(toRpcErrorCode(error));

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
