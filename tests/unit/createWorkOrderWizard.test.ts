import { describe, expect, it } from "vitest";
import {
  CREATE_WORK_ORDER_WIZARD_STEPS,
  canNavigateToWizardStep,
  canProceedFromCustomerStep,
  canProceedFromMotorcycleStep,
  canProceedFromPhotosStep,
  canProceedFromVisitStep,
  canSubmitCreateWorkOrderWizard,
  isWizardStepComplete,
} from "@/lib/forms/createWorkOrderWizard";
import { allRequiredIntakeSelected } from "@/components/forms/IntakePhotoSlots";
import { CREATE_INTAKE_PHOTO_SLOTS } from "@/lib/status/labels";

describe("create work order wizard steps", () => {
  it("defines five forced steps in order", () => {
    expect(CREATE_WORK_ORDER_WIZARD_STEPS.map((s) => s.id)).toEqual([
      "customer",
      "motorcycle",
      "visit",
      "photos",
      "review",
    ]);
    expect(CREATE_WORK_ORDER_WIZARD_STEPS.map((s) => s.label)).toEqual([
      "Customer",
      "Motorcycle",
      "Visit details",
      "Intake photos",
      "Review & create",
    ]);
  });

  it("requires a customer before continuing", () => {
    expect(canProceedFromCustomerStep("")).toBe(false);
    expect(canProceedFromCustomerStep("   ")).toBe(false);
    expect(canProceedFromCustomerStep("cust-1")).toBe(true);
  });

  it("requires a motorcycle before continuing", () => {
    expect(canProceedFromMotorcycleStep("")).toBe(false);
    expect(canProceedFromMotorcycleStep("bike-1")).toBe(true);
  });

  it("requires mileage on visit details; external invoice is optional", () => {
    expect(canProceedFromVisitStep({ mileage: "", externalInvoiceNumber: "" })).toBe(
      false
    );
    expect(
      canProceedFromVisitStep({ mileage: "abc", externalInvoiceNumber: "INV-1" })
    ).toBe(false);
    expect(
      canProceedFromVisitStep({ mileage: "-1", externalInvoiceNumber: "" })
    ).toBe(false);
    expect(
      canProceedFromVisitStep({ mileage: "12000", externalInvoiceNumber: "" })
    ).toBe(true);
    expect(
      canProceedFromVisitStep({
        mileage: "0",
        externalInvoiceNumber: "INV-99",
      })
    ).toBe(true);
  });

  it("requires all six intake photos before continuing", () => {
    expect(canProceedFromPhotosStep(false)).toBe(false);
    expect(canProceedFromPhotosStep(true)).toBe(true);

    const files = Object.fromEntries(
      CREATE_INTAKE_PHOTO_SLOTS.map((slot) => [
        slot.category,
        new File(["x"], `${slot.category}.jpg`, { type: "image/jpeg" }),
      ])
    );
    expect(
      canProceedFromPhotosStep(allRequiredIntakeSelected(files))
    ).toBe(true);
  });

  it("only allows navigating to current or previously reached steps", () => {
    // maxReached = 2 means steps 0,1,2 visited; cannot jump to 3 or 4
    expect(canNavigateToWizardStep(0, 2)).toBe(true);
    expect(canNavigateToWizardStep(2, 2)).toBe(true);
    expect(canNavigateToWizardStep(3, 2)).toBe(false);
    expect(canNavigateToWizardStep(4, 2)).toBe(false);
    expect(canNavigateToWizardStep(1, 4)).toBe(true);
  });

  it("marks step complete based on validation for that step", () => {
    expect(
      isWizardStepComplete("customer", { customerId: "c1" })
    ).toBe(true);
    expect(
      isWizardStepComplete("motorcycle", { motorcycleId: "" })
    ).toBe(false);
    expect(
      isWizardStepComplete("visit", {
        mileage: "100",
        externalInvoiceNumber: "",
      })
    ).toBe(true);
    expect(isWizardStepComplete("photos", { intakeComplete: false })).toBe(
      false
    );
    expect(isWizardStepComplete("review", { intakeComplete: true })).toBe(
      true
    );
  });

  it("only allows final submit on the review step when all gates pass", () => {
    const ready = {
      stepId: "review" as const,
      customerId: "c1",
      motorcycleId: "m1",
      mileage: "5000",
      intakeComplete: true,
    };
    expect(canSubmitCreateWorkOrderWizard(ready)).toBe(true);
    expect(
      canSubmitCreateWorkOrderWizard({ ...ready, stepId: "photos" })
    ).toBe(false);
    expect(
      canSubmitCreateWorkOrderWizard({ ...ready, intakeComplete: false })
    ).toBe(false);
    expect(
      canSubmitCreateWorkOrderWizard({ ...ready, motorcycleId: "" })
    ).toBe(false);
  });
});
