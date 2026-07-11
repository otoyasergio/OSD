export const CREATE_WORK_ORDER_WIZARD_STEPS = [
  { id: "customer", label: "Customer" },
  { id: "motorcycle", label: "Motorcycle" },
  { id: "visit", label: "Visit details" },
  { id: "photos", label: "Intake photos" },
  { id: "review", label: "Review & create" },
] as const;

export type CreateWorkOrderWizardStepId =
  (typeof CREATE_WORK_ORDER_WIZARD_STEPS)[number]["id"];

export function canProceedFromCustomerStep(customerId: string): boolean {
  return customerId.trim().length > 0;
}

export function canProceedFromMotorcycleStep(motorcycleId: string): boolean {
  return motorcycleId.trim().length > 0;
}

export function canProceedFromVisitStep(data: {
  mileage: string;
  externalInvoiceNumber: string;
}): boolean {
  const trimmed = data.mileage.trim();
  if (!trimmed) return false;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0;
}

export function canProceedFromPhotosStep(intakeComplete: boolean): boolean {
  return intakeComplete;
}

/** Jump only to current or previously reached steps — never ahead. */
export function canNavigateToWizardStep(
  targetIndex: number,
  maxReachedIndex: number
): boolean {
  return (
    Number.isInteger(targetIndex) &&
    targetIndex >= 0 &&
    targetIndex <= maxReachedIndex
  );
}

type StepCompleteInput = {
  customerId?: string;
  motorcycleId?: string;
  mileage?: string;
  externalInvoiceNumber?: string;
  intakeComplete?: boolean;
};

export function isWizardStepComplete(
  stepId: CreateWorkOrderWizardStepId,
  data: StepCompleteInput
): boolean {
  switch (stepId) {
    case "customer":
      return canProceedFromCustomerStep(data.customerId ?? "");
    case "motorcycle":
      return canProceedFromMotorcycleStep(data.motorcycleId ?? "");
    case "visit":
      return canProceedFromVisitStep({
        mileage: data.mileage ?? "",
        externalInvoiceNumber: data.externalInvoiceNumber ?? "",
      });
    case "photos":
      return canProceedFromPhotosStep(Boolean(data.intakeComplete));
    case "review":
      // Review is always "complete" once reached; submit has its own gate.
      return true;
    default:
      return false;
  }
}

export function canSubmitCreateWorkOrderWizard(data: {
  stepId: CreateWorkOrderWizardStepId;
  customerId: string;
  motorcycleId: string;
  mileage: string;
  intakeComplete: boolean;
}): boolean {
  if (data.stepId !== "review") return false;
  return (
    canProceedFromCustomerStep(data.customerId) &&
    canProceedFromMotorcycleStep(data.motorcycleId) &&
    canProceedFromVisitStep({
      mileage: data.mileage,
      externalInvoiceNumber: "",
    }) &&
    canProceedFromPhotosStep(data.intakeComplete)
  );
}

export function canProceedFromWizardStep(
  stepId: CreateWorkOrderWizardStepId,
  data: StepCompleteInput
): boolean {
  if (stepId === "review") return false;
  return isWizardStepComplete(stepId, data);
}
