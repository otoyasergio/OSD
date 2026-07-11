"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { WorkOrderFormState } from "@/app/(app)/work_orders/actions";
import { getOutstandingRecommendationsAction } from "@/app/(app)/work_orders/recommendation-actions";
import type { Customer } from "@/lib/services/customers";
import type { MotorcycleWithCustomer } from "@/lib/services/motorcycles";
import type { OutstandingRecommendation } from "@/lib/services/recommendations";
import {
  groupServicesByCategory,
  type Service,
} from "@/lib/services/serviceCatalogueShared";
import type { TechnicianOption } from "@/lib/services/workOrders";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  IntakePhotoSlots,
  allRequiredIntakeSelected,
  type IntakePhotoSelection,
} from "@/components/forms/IntakePhotoSlots";
import { IntakePhotoRecoveryForm } from "@/components/forms/IntakePhotoRecoveryForm";
import { CREATE_INTAKE_PHOTO_SLOTS } from "@/lib/status/labels";
import {
  CREATE_WORK_ORDER_WIZARD_STEPS,
  canNavigateToWizardStep,
  canProceedFromWizardStep,
  canSubmitCreateWorkOrderWizard,
} from "@/lib/forms/createWorkOrderWizard";

type Props = {
  action: (
    state: WorkOrderFormState,
    formData: FormData
  ) => Promise<WorkOrderFormState>;
  customers: Customer[];
  motorcycles: MotorcycleWithCustomer[];
  services: Service[];
  technicians: TechnicianOption[];
  initialCustomerId?: string;
  initialMotorcycleId?: string;
};

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

const INPUT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

const NAV_BTN_CLASS =
  "btn min-h-12 min-w-[8rem] px-6 text-base sm:min-h-14 sm:text-lg";

const ALL_REQUIRED = CREATE_INTAKE_PHOTO_SLOTS.map((s) => s.category);

export function CreateWorkOrderForm({
  action,
  customers,
  motorcycles,
  services,
  technicians,
  initialCustomerId = "",
  initialMotorcycleId = "",
}: Props) {
  const [state, formAction] = useActionState(action, { error: null });
  const [intakePhotos, setIntakePhotos] = useState<IntakePhotoSelection>({});
  const [clientError, setClientError] = useState<string | null>(null);

  const recoveryWorkOrderId = state.workOrderId ?? null;
  const missingCategories = state.missingCategories ?? [];
  const isRecovery = Boolean(
    recoveryWorkOrderId && missingCategories.length > 0
  );

  const resolvedInitialCustomerId =
    initialCustomerId ||
    motorcycles.find((bike) => bike.motorcycle_id === initialMotorcycleId)
      ?.customer_id ||
    "";

  const [customerId, setCustomerId] = useState(resolvedInitialCustomerId);
  const [motorcycleId, setMotorcycleId] = useState(initialMotorcycleId);
  const [externalInvoiceNumber, setExternalInvoiceNumber] = useState("");
  const [mileage, setMileage] = useState("");
  const [estimatedCompletion, setEstimatedCompletion] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [primaryTechnicianId, setPrimaryTechnicianId] = useState("");
  const [outstanding, setOutstanding] = useState<OutstandingRecommendation[]>(
    []
  );

  const initialStepIndex = (() => {
    if (initialMotorcycleId && resolvedInitialCustomerId) return 2;
    if (resolvedInitialCustomerId) return 1;
    return 0;
  })();

  const [stepIndex, setStepIndex] = useState(initialStepIndex);
  const [maxReachedIndex, setMaxReachedIndex] = useState(initialStepIndex);

  const bikesForCustomer = useMemo(() => {
    if (!customerId) return [];
    return motorcycles.filter((bike) => bike.customer_id === customerId);
  }, [customerId, motorcycles]);

  const groupedServices = useMemo(
    () => groupServicesByCategory(services),
    [services]
  );

  const intakeComplete = allRequiredIntakeSelected(intakePhotos, ALL_REQUIRED);
  const stepId = CREATE_WORK_ORDER_WIZARD_STEPS[stepIndex].id;
  const isLastStep = stepId === "review";

  const selectedCustomer = customers.find((c) => c.customer_id === customerId);
  const selectedBike = motorcycles.find(
    (bike) => bike.motorcycle_id === motorcycleId
  );
  const selectedTech = technicians.find(
    (tech) => tech.user_id === primaryTechnicianId
  );
  const selectedServices = services.filter((service) =>
    selectedServiceIds.includes(service.service_id)
  );

  const stepData = {
    customerId,
    motorcycleId,
    mileage,
    externalInvoiceNumber,
    intakeComplete,
  };

  const canProceed = canProceedFromWizardStep(stepId, stepData);

  useEffect(() => {
    if (!motorcycleId) {
      setOutstanding([]);
      return;
    }

    let cancelled = false;
    void getOutstandingRecommendationsAction(motorcycleId).then((rows) => {
      if (!cancelled) setOutstanding(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [motorcycleId]);

  function goNext() {
    if (!canProceed || isLastStep) return;
    const next = Math.min(
      stepIndex + 1,
      CREATE_WORK_ORDER_WIZARD_STEPS.length - 1
    );
    setStepIndex(next);
    setMaxReachedIndex((prev) => Math.max(prev, next));
    setClientError(null);
  }

  function goBack() {
    if (stepIndex === 0) return;
    setStepIndex(stepIndex - 1);
    setClientError(null);
  }

  function goToStep(index: number) {
    if (!canNavigateToWizardStep(index, maxReachedIndex)) return;
    setStepIndex(index);
    setClientError(null);
  }

  if (isRecovery && recoveryWorkOrderId) {
    return (
      <IntakePhotoRecoveryForm
        workOrderId={recoveryWorkOrderId}
        workOrderNumber={state.workOrderNumber}
        missingCategories={missingCategories}
        initialError={state.error}
      />
    );
  }

  return (
    <form
      action={formAction}
      encType="multipart/form-data"
      className="flex max-w-3xl flex-col gap-6"
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        const target = event.target as HTMLElement;
        if (target.tagName === "TEXTAREA") return;
        if (target.tagName === "BUTTON") return;
        // Block Enter from submitting the whole form before the review step.
        event.preventDefault();
        if (!isLastStep && canProceed) goNext();
      }}
      onSubmit={(event) => {
        const ok = canSubmitCreateWorkOrderWizard({
          stepId,
          customerId,
          motorcycleId,
          mileage,
          intakeComplete,
        });
        if (!ok) {
          event.preventDefault();
          setClientError(
            isLastStep
              ? "Complete every required step, including all six intake photos, before creating the work order."
              : "Finish each step in order before creating the work order."
          );
        }
      }}
    >
      <FormError message={state.error ?? clientError} />

      <WizardProgress
        stepIndex={stepIndex}
        maxReachedIndex={maxReachedIndex}
        onSelect={goToStep}
      />

      {/* Persist values for submit regardless of which step is visible */}
      <input type="hidden" name="motorcycle_id" value={motorcycleId} />
      <input
        type="hidden"
        name="external_invoice_number"
        value={externalInvoiceNumber}
      />
      <input type="hidden" name="mileage" value={mileage} />
      <input
        type="hidden"
        name="estimated_completion"
        value={estimatedCompletion}
      />
      <input type="hidden" name="internal_notes" value={internalNotes} />
      <input
        type="hidden"
        name="primary_technician_id"
        value={primaryTechnicianId}
      />
      {selectedServiceIds.map((id) => (
        <input key={id} type="hidden" name="service_ids" value={id} />
      ))}

      {stepId === "customer" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-zinc-900">Customer</h2>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Customer <span className="ml-1 text-red-600">*</span>
            </span>
            <select
              className={SELECT_CLASS}
              value={customerId}
              onChange={(event) => {
                setCustomerId(event.target.value);
                setMotorcycleId("");
                setMaxReachedIndex(0);
              }}
              required
            >
              <option value="">Select a customer</option>
              {customers.map((customer) => (
                <option
                  key={customer.customer_id}
                  value={customer.customer_id}
                >
                  {customer.last_name}, {customer.first_name}
                  {customer.phone ? ` · ${customer.phone}` : ""}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-zinc-500">
              Need a new customer?{" "}
              <Link
                href="/customers/new"
                className="underline underline-offset-2"
              >
                Create one first
              </Link>
              .
            </span>
          </label>
        </section>
      ) : null}

      {stepId === "motorcycle" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-zinc-900">Motorcycle</h2>
          <p className="text-sm text-zinc-600">
            Customer:{" "}
            <span className="font-medium text-zinc-900">
              {selectedCustomer
                ? `${selectedCustomer.last_name}, ${selectedCustomer.first_name}`
                : "—"}
            </span>
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Motorcycle <span className="ml-1 text-red-600">*</span>
            </span>
            <select
              className={SELECT_CLASS}
              value={motorcycleId}
              onChange={(event) => {
                setMotorcycleId(event.target.value);
                setMaxReachedIndex((prev) => Math.min(prev, 1));
              }}
              required
              disabled={!customerId}
            >
              <option value="">Select a motorcycle</option>
              {bikesForCustomer.map((bike) => (
                <option key={bike.motorcycle_id} value={bike.motorcycle_id}>
                  {bike.year} {bike.make} {bike.model}
                  {bike.vin ? ` · ${bike.vin}` : " · Missing VIN"}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-zinc-500">
              Need a new bike?{" "}
              <Link
                href={
                  customerId
                    ? `/motorcycles/new?customer_id=${customerId}`
                    : "/motorcycles/new"
                }
                className="underline underline-offset-2"
              >
                Create one first
              </Link>
              .
            </span>
          </label>
          {outstanding.length > 0 ? (
            <p
              role="status"
              className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              This motorcycle has {outstanding.length} outstanding
              recommendation
              {outstanding.length === 1 ? "" : "s"} from previous visits
              (pending, deferred, or declined). Review them on the bike
              profile after creating this work order.
            </p>
          ) : null}
        </section>
      ) : null}

      {stepId === "visit" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-zinc-900">Visit details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                External invoice #
              </span>
              <input
                className={INPUT_CLASS}
                value={externalInvoiceNumber}
                onChange={(event) =>
                  setExternalInvoiceNumber(event.target.value)
                }
                placeholder="From invoicing software"
              />
              {!externalInvoiceNumber.trim() ? (
                <span className="mt-1 block text-xs text-amber-800">
                  Recommended — helps match this visit to your invoicing
                  software.
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                Mileage <span className="ml-1 text-red-600">*</span>
              </span>
              <input
                className={INPUT_CLASS}
                type="number"
                min={0}
                inputMode="numeric"
                value={mileage}
                onChange={(event) => setMileage(event.target.value)}
                required
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                Estimated completion
              </span>
              <input
                className={SELECT_CLASS}
                type="datetime-local"
                value={estimatedCompletion}
                onChange={(event) =>
                  setEstimatedCompletion(event.target.value)
                }
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Internal notes
            </span>
            <textarea
              className="min-h-24 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
              rows={3}
              value={internalNotes}
              onChange={(event) => setInternalNotes(event.target.value)}
            />
          </label>

          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold text-zinc-900">Services</h3>
            <p className="text-sm text-zinc-600">
              Selected services become approved jobs on the work order
              (optional).
            </p>
            {services.length === 0 ? (
              <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-600">
                No active services in the catalogue.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {groupedServices.map(
                  ({ category, services: categoryServices }) => (
                    <div key={category}>
                      <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                        {category}
                      </h4>
                      <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
                        {categoryServices.map((service) => {
                          const checked = selectedServiceIds.includes(
                            service.service_id
                          );
                          return (
                            <li key={service.service_id}>
                              <label className="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedServiceIds((prev) =>
                                      checked
                                        ? prev.filter(
                                            (id) => id !== service.service_id
                                          )
                                        : [...prev, service.service_id]
                                    );
                                  }}
                                  className="mt-1 h-4 w-4"
                                />
                                <span>
                                  <span className="block font-medium text-zinc-900">
                                    {service.name}
                                  </span>
                                  <span className="block text-sm text-zinc-600">
                                    {service.standard_price != null
                                      ? `$${service.standard_price}`
                                      : "No price"}
                                    {service.estimated_labour != null
                                      ? ` · ${service.estimated_labour} h`
                                      : ""}
                                  </span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Primary technician
            </span>
            <select
              className={SELECT_CLASS}
              value={primaryTechnicianId}
              onChange={(event) =>
                setPrimaryTechnicianId(event.target.value)
              }
            >
              <option value="">Unassigned</option>
              {technicians.map((tech) => (
                <option key={tech.user_id} value={tech.user_id}>
                  {tech.first_name} {tech.last_name}
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : null}

      {/* Keep file inputs mounted so Safari/FormData retain selected photos */}
      <section
        className={
          stepId === "photos" ? "flex flex-col gap-3" : "sr-only"
        }
        aria-hidden={stepId !== "photos"}
      >
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">
            Intake photos <span className="text-red-600">*</span>
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Capture all six angles before continuing. On iPad, tap a slot to
            use the camera.
          </p>
        </div>
        <IntakePhotoSlots
          value={intakePhotos}
          htmlRequired={false}
          onChange={(next) => {
            // Ignore changes while off the photos step so hidden inputs
            // stay in the form for submit (disabled inputs are omitted).
            if (stepId !== "photos") return;
            setIntakePhotos(next);
            setClientError(null);
            if (!allRequiredIntakeSelected(next, ALL_REQUIRED)) {
              setMaxReachedIndex((prev) => Math.min(prev, 3));
              setStepIndex((prev) => Math.min(prev, 3));
            }
          }}
        />
        {stepId === "photos" ? (
          !intakeComplete ? (
            <p className="text-sm text-zinc-500">
              {
                Object.values(intakePhotos).filter(
                  (file) => file instanceof File && file.size > 0
                ).length
              }
              /6 selected
            </p>
          ) : (
            <p className="text-sm text-emerald-700">
              All six intake photos ready.
            </p>
          )
        ) : null}
      </section>

      {stepId === "review" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-zinc-900">
            Review & create
          </h2>
          <dl className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
            <ReviewRow
              label="Customer"
              value={
                selectedCustomer
                  ? `${selectedCustomer.last_name}, ${selectedCustomer.first_name}`
                  : "—"
              }
            />
            <ReviewRow
              label="Motorcycle"
              value={
                selectedBike
                  ? `${selectedBike.year} ${selectedBike.make} ${selectedBike.model}`
                  : "—"
              }
            />
            <ReviewRow
              label="External invoice #"
              value={externalInvoiceNumber.trim() || "Not provided"}
            />
            <ReviewRow label="Mileage" value={mileage || "—"} />
            <ReviewRow
              label="Estimated completion"
              value={
                estimatedCompletion
                  ? new Date(estimatedCompletion).toLocaleString()
                  : "Not set"
              }
            />
            <ReviewRow
              label="Primary technician"
              value={
                selectedTech
                  ? `${selectedTech.first_name} ${selectedTech.last_name}`
                  : "Unassigned"
              }
            />
            <ReviewRow
              label="Services"
              value={
                selectedServices.length > 0
                  ? selectedServices.map((s) => s.name).join(", ")
                  : "None selected"
              }
            />
            <ReviewRow
              label="Intake photos"
              value={intakeComplete ? "All 6 ready" : "Incomplete"}
            />
            {internalNotes.trim() ? (
              <ReviewRow label="Internal notes" value={internalNotes} />
            ) : null}
          </dl>
          {!externalInvoiceNumber.trim() ? (
            <p
              role="status"
              className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              No external invoice # — you can still create this work order.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-4">
        {stepIndex > 0 ? (
          <button
            type="button"
            className={`${NAV_BTN_CLASS} btn-secondary`}
            onClick={goBack}
          >
            Back
          </button>
        ) : (
          <span className="min-w-[8rem]" aria-hidden />
        )}
        <div className="ml-auto flex flex-wrap gap-3">
          {!isLastStep ? (
            <button
              type="button"
              className={`${NAV_BTN_CLASS} btn-primary`}
              disabled={!canProceed}
              onClick={goNext}
            >
              Next
            </button>
          ) : (
            <span
              className={
                canSubmitCreateWorkOrderWizard({
                  stepId,
                  customerId,
                  motorcycleId,
                  mileage,
                  intakeComplete,
                })
                  ? undefined
                  : "pointer-events-none opacity-60"
              }
            >
              <SubmitButton
                label="Create work order"
                pendingLabel="Creating & uploading…"
                className="min-h-12 min-w-[8rem] px-6 text-base sm:min-h-14 sm:text-lg"
              />
            </span>
          )}
        </div>
      </div>
    </form>
  );
}

function WizardProgress({
  stepIndex,
  maxReachedIndex,
  onSelect,
}: {
  stepIndex: number;
  maxReachedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav aria-label="Work order steps" className="overflow-x-auto">
      <ol className="flex min-w-full gap-2 sm:gap-3">
        {CREATE_WORK_ORDER_WIZARD_STEPS.map((step, index) => {
          const isCurrent = index === stepIndex;
          const isComplete = index < stepIndex;
          const canClick = canNavigateToWizardStep(index, maxReachedIndex);
          const clickable = canClick && !isCurrent;

          return (
            <li key={step.id} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onSelect(index)}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex w-full flex-col items-start gap-1 rounded border px-3 py-3 text-left transition ${
                  isCurrent
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : isComplete
                      ? "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-500"
                      : "border-zinc-200 bg-zinc-50 text-zinc-400"
                } ${!clickable ? "cursor-default" : "cursor-pointer"}`}
              >
                <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
                  Step {index + 1}
                </span>
                <span className="text-sm font-semibold leading-tight">
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="text-sm text-zinc-900">{value}</dd>
    </div>
  );
}
