import type {
  JobStatus,
  PartRequirementState,
  WorkOrderStatus,
} from "@/lib/database/types";
import type { MileageUnit } from "@/lib/mileage/format";
import { hashPassportPayload } from "@/lib/passport/digest";
import { validatePassportPayload } from "@/lib/passport/privacy";
import type { PassportSnapshotPayload } from "@/lib/passport/schema";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

type PassportSourcePart = {
  description: string;
  part_number: string | null;
  quantity_installed: number;
  state: PartRequirementState;
};

type PassportSourceJob = {
  job_id: string;
  service_name_snapshot: string;
  status: JobStatus;
  part_requirements: PassportSourcePart[];
};

type PassportSourceWorkOrder = {
  work_order_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  completed_at: string | null;
  mileage: number | null;
  mileage_unit: MileageUnit;
  location_name: string;
  jobs: PassportSourceJob[];
};

export type PassportDraftInput = {
  passportNumber: string;
  reportVersion: number;
  issuedAt: string;
  motorcycle: {
    year: number;
    make: string;
    model: string;
    vin: string | null;
    colour: string | null;
  };
  workOrders: PassportSourceWorkOrder[];
  sensitiveValues?: string[];
};

export type PassportDraft = {
  payload: PassportSnapshotPayload;
  payloadSha256: string;
  sourceWorkOrderIds: string[];
};

export class PassportSourceError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "PassportSourceError";
  }
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-CA");
}

function cleanOptional(value: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export function buildPassportDraft(input: PassportDraftInput): PassportDraft {
  const completedWorkOrders = input.workOrders.filter(
    (workOrder) => workOrder.status === "completed"
  );

  for (const workOrder of completedWorkOrders) {
    if (!workOrder.completed_at) {
      throw new PassportSourceError("PASSPORT_COMPLETION_DATE_REQUIRED");
    }
  }

  const entries = completedWorkOrders
    .flatMap((workOrder) => {
      const completedJobs = workOrder.jobs.filter((job) => job.status === "completed");
      if (completedJobs.length === 0) return [];

      const completedServices = completedJobs
        .map((job) => job.service_name_snapshot.trim())
        .filter(Boolean)
        .sort(compareText);
      if (completedServices.length === 0) return [];

      const installedParts = completedJobs
        .flatMap((job) => job.part_requirements)
        .filter(
          (part) => part.state === "installed" && Number(part.quantity_installed) > 0
        )
        .map((part) => ({
          description: part.description.trim(),
          part_number: cleanOptional(part.part_number),
          quantity: Number(part.quantity_installed),
        }))
        .filter((part) => part.description.length > 0)
        .sort((left, right) => {
          const descriptionOrder = compareText(left.description, right.description);
          if (descriptionOrder !== 0) return descriptionOrder;
          return compareText(left.part_number ?? "", right.part_number ?? "");
        });

      return [
        {
          workOrderId: workOrder.work_order_id,
          completedAt: workOrder.completed_at!,
          publicEntry: {
            service_date: workOrder.completed_at!.slice(0, 10),
            work_order_reference: workOrder.work_order_number.trim(),
            mileage:
              workOrder.mileage == null
                ? null
                : {
                    value: Number(workOrder.mileage),
                    unit: workOrder.mileage_unit,
                  },
            location: workOrder.location_name.trim(),
            source_label: "OTOMOTO performed" as const,
            completed_services: completedServices,
            installed_parts: installedParts,
          },
        },
      ];
    })
    .sort((left, right) => {
      const dateOrder = left.completedAt.localeCompare(right.completedAt);
      if (dateOrder !== 0) return dateOrder;
      return compareText(
        left.publicEntry.work_order_reference,
        right.publicEntry.work_order_reference
      );
    });

  if (entries.length === 0) {
    throw new PassportSourceError("PASSPORT_NO_COMPLETED_SERVICE");
  }

  const payload = validatePassportPayload(
    {
      schema_version: 1,
      passport_number: input.passportNumber,
      report_version: input.reportVersion,
      issued_at: input.issuedAt,
      coverage_through: entries.at(-1)!.completedAt,
      issuer: {
        legal_name: TORONTO_SHOP.legalName,
        address: `${TORONTO_SHOP.fullAddress}, Canada`,
        phone: TORONTO_SHOP.phoneDisplay,
      },
      vehicle: {
        year: input.motorcycle.year,
        make: input.motorcycle.make.trim(),
        model: input.motorcycle.model.trim(),
        vin: cleanOptional(input.motorcycle.vin),
        colour: cleanOptional(input.motorcycle.colour),
      },
      service_entries: entries.map((entry) => entry.publicEntry),
      limitations: [
        "This passport covers the OTOMOTO records listed through the coverage date.",
        "It is not a statement of current condition or a complete lifetime history.",
      ],
    },
    input.sensitiveValues
  );

  return {
    payload,
    payloadSha256: hashPassportPayload(payload),
    sourceWorkOrderIds: entries.map((entry) => entry.workOrderId),
  };
}
