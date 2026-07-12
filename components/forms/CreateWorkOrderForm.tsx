"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createWorkOrderOnlyAction,
  type WorkOrderFormState,
} from "@/app/(app)/work_orders/actions";
import { uploadIntakePhotoAction } from "@/app/(app)/work_orders/photo-actions";
import { getOutstandingRecommendationsAction } from "@/app/(app)/work_orders/recommendation-actions";
import type { Customer } from "@/lib/services/customers";
import type { MotorcycleWithCustomer } from "@/lib/services/motorcycles";
import type { OutstandingRecommendation } from "@/lib/services/recommendations";
import {
  groupServicesByCategory,
  type Service,
} from "@/lib/services/serviceCatalogueShared";
import type { TechnicianOption } from "@/lib/services/workOrders";
import type { PhotoCategory } from "@/lib/database/types";
import { FormError } from "@/components/forms/Field";
import {
  IntakePhotoSlots,
  allRequiredIntakeSelected,
  type IntakePhotoSelection,
} from "@/components/forms/IntakePhotoSlots";
import { IntakePhotoRecoveryForm } from "@/components/forms/IntakePhotoRecoveryForm";
import { VinDecodePanel } from "@/components/forms/VinDecodePanel";
import { FindMotorcycleByVin } from "@/components/forms/FindMotorcycleByVin";

import { CREATE_INTAKE_PHOTO_SLOTS, PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import {
  CREATE_WORK_ORDER_WIZARD_STEPS,
  canNavigateToWizardStep,
  canProceedFromWizardStep,
  canSubmitCreateWorkOrderWizard,
} from "@/lib/forms/createWorkOrderWizard";
import { compressImageForUpload } from "@/lib/forms/compressImageForUpload";
import { stripIntakePhotoFields } from "@/lib/forms/intakeFormData";
import { toFormErrorMessage } from "@/lib/services/errors";

type Props = {
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
  customers,
  motorcycles,
  services,
  technicians,
  initialCustomerId = "",
  initialMotorcycleId = "",
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [intakePhotos, setIntakePhotos] = useState<IntakePhotoSelection>({});
  const [clientError, setClientError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<WorkOrderFormState | null>(null);

  const recoveryWorkOrderId = recovery?.workOrderId ?? null;
  const missingCategories = recovery?.missingCategories ?? [];
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
  const [outstandingFetch, setOutstandingFetch] = useState<{
    motorcycleId: string;
    rows: OutstandingRecommendation[];
  } | null>(null);
  // Only show recommendations fetched for the currently selected bike; a
  // stale or absent fetch reads as empty.
  const outstanding =
    motorcycleId && outstandingFetch?.motorcycleId === motorcycleId
      ? outstandingFetch.rows
      : [];

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
    if (!motorcycleId) return;

    let cancelled = false;
    void getOutstandingRecommendationsAction(motorcycleId).then((rows) => {
      if (!cancelled) setOutstandingFetch({ motorcycleId, rows });
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

  async function submitCreate(form: HTMLFormElement) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setClientError(null);
    setSubmitting(true);

    try {
      const formData = new FormData(form);
      // Never send six camera originals in one serverless POST — Vercel rejects
      // large bodies with an unexpected-response crash instead of a form error.
      stripIntakePhotoFields(formData, ALL_REQUIRED);

      const created = await createWorkOrderOnlyAction({ error: null }, formData);
      if (created.error || !created.workOrderId) {
        setClientError(
          created.error ?? "Could not create the work order. Try again."
        );
        return;
      }

      const failed: PhotoCategory[] = [];
      for (const category of ALL_REQUIRED) {
        const original = intakePhotos[category];
        if (!(original instanceof File) || original.size === 0) {
          failed.push(category);
          continue;
        }

        try {
          const file = await compressImageForUpload(original);
          const photoData = new FormData();
          photoData.set("file", file);
          photoData.set("category", category);
          const uploaded = await uploadIntakePhotoAction(
            created.workOrderId,
            { error: null },
            photoData
          );
          if (uploaded.error) failed.push(category);
        } catch {
          failed.push(category);
        }
      }

      if (failed.length > 0) {
        const labels = failed
          .map((c) => PHOTO_CATEGORY_LABELS[c] ?? c)
          .join(", ");
        setRecovery({
          error: `${toFormErrorMessage(new Error("INTAKE_PHOTOS_PARTIAL"))} Missing: ${labels}.`,
          workOrderId: created.workOrderId,
          workOrderNumber: created.workOrderNumber,
          missingCategories: failed,
        });
        return;
      }

      router.push(`/work_orders/${created.workOrderId}/contract?from=intake`);
      router.refresh();
    } catch (error) {
      setClientError(toFormErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (isRecovery && recoveryWorkOrderId) {
    return (
      <IntakePhotoRecoveryForm
        workOrderId={recoveryWorkOrderId}
        workOrderNumber={recovery?.workOrderNumber}
        missingCategories={missingCategories}
        initialError={recovery?.error}
      />
    );
  }

  const selectedPhotoCount = Object.values(intakePhotos).filter(
    (file) => file instanceof File && file.size > 0
  ).length;

  return (
    <form
      encType="multipart/form-data"
      className="intake-wizard"
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
        event.preventDefault();
        const ok = canSubmitCreateWorkOrderWizard({
          stepId,
          customerId,
          motorcycleId,
          mileage,
          intakeComplete,
        });
        if (!ok) {
          setClientError(
            isLastStep
              ? "Complete every required step, including all six intake photos, before creating the work order."
              : "Finish each step in order before creating the work order."
          );
          return;
        }

        const form = event.currentTarget;
        void submitCreate(form);
      }}
    >
      <FormError message={clientError} />

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
        <section className="intake-wizard-panel">
          <h2 className="intake-wizard-panel-title">Customer</h2>
          <p className="intake-wizard-panel-lede">
            Who owns the bike for this visit?
          </p>
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
        <section className="intake-wizard-panel">
          <h2 className="intake-wizard-panel-title">Motorcycle</h2>
          <p className="intake-wizard-panel-lede">
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
            {customerId && bikesForCustomer.length === 0 ? (
              <span className="mt-1 block text-sm text-amber-800">
                This customer has no motorcycles yet. Create one to continue.
              </span>
            ) : null}
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
          {customerId ? (
            <FindMotorcycleByVin
              customerId={customerId}
              currentCustomerName={
                selectedCustomer
                  ? `${selectedCustomer.first_name} ${selectedCustomer.last_name}`
                  : undefined
              }
              onSelectMotorcycle={(id) => {
                setMotorcycleId(id);
                setMaxReachedIndex((prev) => Math.min(prev, 1));
                router.refresh();
              }}
            />
          ) : null}
          {selectedBike ? <VinDecodePanel vin={selectedBike.vin} /> : null}
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
        <section className="intake-wizard-panel">
          <h2 className="intake-wizard-panel-title">Visit details</h2>
          <p className="intake-wizard-panel-lede">
            Mileage, invoice reference, services, and technician.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                External invoice # (optional legacy)
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
                step={1}
                inputMode="numeric"
                value={mileage}
                onChange={(event) => setMileage(event.target.value)}
                required
              />
              {mileage.trim() && !/^\d+$/.test(mileage.trim()) ? (
                <span className="mt-1 block text-xs text-red-700">
                  Enter whole kilometres or miles (no decimals).
                </span>
              ) : null}
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
          stepId === "photos" ? "intake-wizard-panel" : "sr-only"
        }
        aria-hidden={stepId !== "photos"}
      >
        <div className="intake-photo-header">
          <div>
            <h2 className="intake-wizard-panel-title">
              Intake photos <span className="text-red-600">*</span>
            </h2>
            <p className="intake-wizard-panel-lede mt-1">
              Capture all six angles before continuing. On iPad, tap a slot to
              use the camera.
            </p>
          </div>
          {stepId === "photos" ? (
            <div
              className={`intake-photo-progress${
                intakeComplete ? " is-complete" : ""
              }`}
              role="status"
              aria-live="polite"
            >
              <span className="intake-photo-progress-meter">
                {selectedPhotoCount}/6
              </span>
              {intakeComplete ? "All set" : "photos selected"}
            </div>
          ) : null}
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
      </section>

      {stepId === "review" ? (
        <section className="intake-wizard-panel">
          <h2 className="intake-wizard-panel-title">Review & create</h2>
          <p className="intake-wizard-panel-lede">
            Confirm details, then create the work order and upload intake
            photos.
          </p>
          <div className="intake-review-grid">
            <ReviewCard
              label="Customer"
              value={
                selectedCustomer
                  ? `${selectedCustomer.last_name}, ${selectedCustomer.first_name}`
                  : "—"
              }
            />
            <ReviewCard
              label="Motorcycle"
              value={
                selectedBike
                  ? `${selectedBike.year} ${selectedBike.make} ${selectedBike.model}`
                  : "—"
              }
            />
            <ReviewCard
              label="External invoice #"
              value={externalInvoiceNumber.trim() || "Not provided"}
              muted={!externalInvoiceNumber.trim()}
            />
            <ReviewCard label="Mileage" value={mileage || "—"} />
            <ReviewCard
              label="Estimated completion"
              value={
                estimatedCompletion
                  ? new Date(estimatedCompletion).toLocaleString()
                  : "Not set"
              }
              muted={!estimatedCompletion}
            />
            <ReviewCard
              label="Primary technician"
              value={
                selectedTech
                  ? `${selectedTech.first_name} ${selectedTech.last_name}`
                  : "Unassigned"
              }
              muted={!selectedTech}
            />
            <ReviewCard
              label="Services"
              value={
                selectedServices.length > 0
                  ? selectedServices.map((s) => s.name).join(", ")
                  : "None selected"
              }
              muted={selectedServices.length === 0}
              wide
            />
            <ReviewCard
              label="Intake photos"
              value={intakeComplete ? "All 6 ready" : "Incomplete"}
              ok={intakeComplete}
              wide
            />
            {internalNotes.trim() ? (
              <ReviewCard
                label="Internal notes"
                value={internalNotes}
                wide
              />
            ) : null}
          </div>
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

      <div className="intake-wizard-nav">
        {stepIndex > 0 ? (
          <button
            type="button"
            className={`${NAV_BTN_CLASS} btn-secondary`}
            onClick={goBack}
          >
            Back
          </button>
        ) : (
          <span className="intake-wizard-nav-spacer" aria-hidden />
        )}
        <div className="intake-wizard-nav-actions">
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
            <button
              type="submit"
              disabled={
                submitting ||
                !canSubmitCreateWorkOrderWizard({
                  stepId,
                  customerId,
                  motorcycleId,
                  mileage,
                  intakeComplete,
                })
              }
              className={`${NAV_BTN_CLASS} btn-primary disabled:pointer-events-none disabled:opacity-60`}
            >
              {submitting ? "Creating & uploading…" : "Create work order"}
            </button>
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
    <nav aria-label="Work order steps" className="intake-wizard-progress">
      <ol className="intake-wizard-progress-list">
        {CREATE_WORK_ORDER_WIZARD_STEPS.map((step, index) => {
          const isCurrent = index === stepIndex;
          const isComplete = index < stepIndex;
          const isUpcoming = !isCurrent && !isComplete;
          const canClick = canNavigateToWizardStep(index, maxReachedIndex);
          const clickable = canClick && !isCurrent;

          return (
            <li
              key={step.id}
              className={`intake-wizard-progress-item${
                isCurrent ? " is-current" : ""
              }${isComplete ? " is-complete" : ""}${
                isUpcoming ? " is-upcoming" : ""
              }`}
            >
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onSelect(index)}
                aria-current={isCurrent ? "step" : undefined}
                className={`intake-wizard-progress-btn${
                  isCurrent ? " is-current" : ""
                }${isComplete ? " is-complete" : ""}${
                  isUpcoming ? " is-upcoming" : ""
                }${clickable ? " is-clickable" : ""}`}
              >
                <span className="intake-wizard-progress-pill" aria-hidden>
                  {isComplete ? <ProgressCheckIcon /> : index + 1}
                </span>
                <span className="intake-wizard-progress-label">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ProgressCheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ReviewCard({
  label,
  value,
  muted = false,
  ok = false,
  wide = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  ok?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`intake-review-card${wide ? " is-wide" : ""}`}>
      <div className="intake-review-card-label">{label}</div>
      <div
        className={`intake-review-card-value${muted ? " is-muted" : ""}${
          ok ? " is-ok" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
