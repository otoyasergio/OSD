import type { WorkOrderStatus } from "@/lib/database/types";
import { isJobIdleAtLeastThreeDays } from "@/lib/control-center/atRisk";

export type AccountabilityStage =
  | "intake"
  | "inspection"
  | "approval"
  | "parts"
  | "in_progress"
  | "final_check"
  | "safety"
  | "pickup"
  | "storage"
  | "insurance"
  | "completed"
  | "cancelled"
  | "on_hold";

export type StageResponsibleRole = "advisor" | "technician" | "head_tech" | "owner";

export type StageContract = {
  stage: AccountabilityStage;
  responsibleRole: StageResponsibleRole;
  responsibleName: string | null;
  evidenceRequired: string;
  evidenceMissing: string | null;
  nextAction: string;
  deadline: string | null;
  escalationName: string | null;
};

export type StageContractInput = {
  status: WorkOrderStatus;
  advisorName: string | null;
  technicianName: string | null;
  ownerName: string | null;
  intakePhotoCount: number;
  inspectionSigned: boolean;
  hasConfirmedEstimate: boolean;
  hasMaximumAuthorization: boolean;
  partsShort: boolean;
  partsExpectedAt: string | null;
  lastJobActivityAt: string | null;
  finalCheckRecorded: boolean;
  safetyRequired: boolean;
  safetyChecked: boolean;
  checkoutComplete: boolean;
  estimatedCompletion: string | null;
  now: string;
};

const REQUIRED_INTAKE_PHOTOS = 6;

function stageForStatus(status: WorkOrderStatus): AccountabilityStage {
  switch (status) {
    case "draft":
    case "open":
      return "intake";
    case "inspection_in_progress":
      return "inspection";
    case "waiting_for_customer_approval":
      return "approval";
    case "waiting_for_parts":
      return "parts";
    case "ready_for_technician":
    case "in_progress":
      return "in_progress";
    case "quality_check":
      return "final_check";
    case "safety_check":
      return "safety";
    case "ready_for_pickup":
      return "pickup";
    case "in_storage":
      return "storage";
    case "insurance":
      return "insurance";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "on_hold":
      return "on_hold";
    default:
      return "in_progress";
  }
}

export function stageContractFor(input: StageContractInput): StageContract {
  const stage = stageForStatus(input.status);
  const advisor = input.advisorName;
  const owner = input.ownerName;
  const missingAdvisor = advisor ? null : "No advisor of record";

  if (stage === "intake") {
    const photosShort = input.intakePhotoCount < REQUIRED_INTAKE_PHOTOS;
    return {
      stage,
      responsibleRole: "advisor",
      responsibleName: advisor,
      evidenceRequired: "Six intake photos",
      evidenceMissing: missingAdvisor ?? (photosShort ? "Six intake photos" : null),
      nextAction: input.technicianName
        ? "Record a promise date"
        : "Assign a technician or record a promise date",
      deadline: input.estimatedCompletion,
      escalationName: owner,
    };
  }

  if (stage === "inspection") {
    return {
      stage,
      responsibleRole: "technician",
      responsibleName: input.technicianName,
      evidenceRequired: "Signed arrival inspection",
      evidenceMissing: input.inspectionSigned ? null : "Signed arrival inspection",
      nextAction: "Present an estimate or record a maximum authorization",
      deadline: input.now,
      escalationName: advisor ?? owner,
    };
  }

  if (stage === "approval") {
    const authorized = input.hasConfirmedEstimate || input.hasMaximumAuthorization;
    return {
      stage,
      responsibleRole: "advisor",
      responsibleName: advisor,
      evidenceRequired: "Presented estimate version or a written maximum",
      evidenceMissing: authorized
        ? missingAdvisor
        : "Presented estimate version or a written maximum",
      nextAction: "Follow up on the promise date. Chargeable work stays blocked",
      deadline: input.estimatedCompletion,
      escalationName: owner,
    };
  }

  if (stage === "parts") {
    return {
      stage,
      responsibleRole: "advisor",
      responsibleName: advisor,
      evidenceRequired: "Purchase order with an expected date",
      evidenceMissing: input.partsShort
        ? "A line is still short. The promise date cannot assume a full delivery"
        : input.partsExpectedAt
          ? missingAdvisor
          : "Purchase order with an expected date",
      nextAction:
        "Receive the short lines. Receiving creates an install task for the technician",
      deadline: input.partsExpectedAt ?? input.estimatedCompletion,
      escalationName: advisor ?? owner,
    };
  }

  if (stage === "in_progress") {
    const idle = isJobIdleAtLeastThreeDays(input.lastJobActivityAt, new Date(input.now));
    return {
      stage,
      responsibleRole: "technician",
      responsibleName: input.technicianName,
      evidenceRequired: "Confirmed estimate version or authorized maximum",
      evidenceMissing:
        input.hasConfirmedEstimate || input.hasMaximumAuthorization
          ? idle
            ? "No job activity for three days"
            : null
          : "Confirmed estimate version or authorized maximum",
      nextAction: "Complete the authorized jobs",
      deadline: input.lastJobActivityAt
        ? new Date(
            new Date(input.lastJobActivityAt).getTime() + 3 * 24 * 60 * 60 * 1000
          ).toISOString()
        : input.estimatedCompletion,
      escalationName: advisor ?? owner,
    };
  }

  if (stage === "final_check") {
    return {
      stage,
      responsibleRole: "advisor",
      responsibleName: advisor,
      evidenceRequired: "Final-check record from a person who did not clock the job",
      evidenceMissing: input.finalCheckRecorded ? null : "Final-check record",
      nextAction: input.safetyRequired
        ? "Send the bike to safety"
        : "Send the bike to pickup",
      deadline: input.now,
      escalationName: advisor ?? owner,
    };
  }

  if (stage === "safety") {
    return {
      stage,
      responsibleRole: "head_tech",
      responsibleName: null,
      evidenceRequired: "Head-tech safety check, separate from the arrival inspection",
      evidenceMissing: input.safetyChecked ? null : "Head-tech safety check",
      nextAction: "Pass safety, or fail into recommendations and a new approval",
      deadline: input.now,
      escalationName: owner,
    };
  }

  if (stage === "pickup") {
    return {
      stage,
      responsibleRole: "advisor",
      responsibleName: advisor,
      evidenceRequired: "Checkout photos",
      evidenceMissing: input.checkoutComplete ? missingAdvisor : "Checkout photos",
      nextAction: "Release the bike or move it to storage",
      deadline: input.estimatedCompletion,
      escalationName: owner,
    };
  }

  if (stage === "storage" || stage === "insurance") {
    return {
      stage,
      responsibleRole: "advisor",
      responsibleName: advisor,
      evidenceRequired: "Parked. Job updates do not move this bike",
      evidenceMissing: missingAdvisor,
      nextAction:
        stage === "storage"
          ? "Book retrieval when the customer wants the bike"
          : "Work the bike only on an authorized supplement",
      deadline: null,
      escalationName: owner,
    };
  }

  return {
    stage,
    responsibleRole: "advisor",
    responsibleName: advisor,
    evidenceRequired: "No further shop action",
    evidenceMissing: null,
    nextAction: stage === "on_hold" ? "Resume when the hold reason is cleared" : "None",
    deadline: null,
    escalationName: owner,
  };
}

export type AdvisorQueueKind =
  | "unanswered_message"
  | "pending_approval"
  | "overdue_parts"
  | "missed_promise"
  | "customer_update";

const CLOSED: WorkOrderStatus[] = ["completed", "cancelled"];

export function advisorQueueKinds(input: {
  status: WorkOrderStatus;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  partsExpectedAt: string | null;
  partsShort: boolean;
  estimatedCompletion: string | null;
  readyForPickupAt: string | null;
  hasPresentedUnconfirmedEstimate: boolean;
  now: string;
}): AdvisorQueueKind[] {
  if (CLOSED.includes(input.status)) return [];
  const kinds: AdvisorQueueKind[] = [];
  const now = new Date(input.now).getTime();

  if (
    input.lastInboundAt &&
    (!input.lastOutboundAt ||
      new Date(input.lastInboundAt).getTime() > new Date(input.lastOutboundAt).getTime())
  ) {
    kinds.push("unanswered_message");
  }

  if (
    input.status === "waiting_for_customer_approval" ||
    input.hasPresentedUnconfirmedEstimate
  ) {
    kinds.push("pending_approval");
  }

  if (
    input.partsShort &&
    input.partsExpectedAt &&
    new Date(input.partsExpectedAt).getTime() < now
  ) {
    kinds.push("overdue_parts");
  }

  if (
    input.estimatedCompletion &&
    new Date(input.estimatedCompletion).getTime() < now &&
    input.status !== "in_storage" &&
    input.status !== "insurance"
  ) {
    kinds.push("missed_promise");
  }

  const pickupWithoutNotice =
    input.status === "ready_for_pickup" &&
    (!input.lastOutboundAt ||
      (input.readyForPickupAt != null &&
        new Date(input.lastOutboundAt).getTime() <
          new Date(input.readyForPickupAt).getTime()));
  const approvalGoneQuiet =
    input.status === "waiting_for_customer_approval" &&
    (!input.lastOutboundAt ||
      now - new Date(input.lastOutboundAt).getTime() >= 2 * 24 * 60 * 60 * 1000);
  if (pickupWithoutNotice || approvalGoneQuiet) {
    kinds.push("customer_update");
  }

  return kinds;
}
