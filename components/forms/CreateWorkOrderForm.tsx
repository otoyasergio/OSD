"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createWorkOrderOnlyAction,
  type WorkOrderFormState,
} from "@/app/(app)/work_orders/actions";
import { getOutstandingRecommendationsAction } from "@/app/(app)/work_orders/recommendation-actions";
import { listMotorcyclesForCustomerAction } from "@/app/(app)/motorcycles/actions";
import type { Customer } from "@/lib/services/customers";
import type { Motorcycle, MotorcycleWithCustomer } from "@/lib/services/motorcycles";
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
import { OptionalIntakePhotos } from "@/components/forms/OptionalIntakePhotos";
import {
  intakeContractHref,
  uploadOptionalIntakePhotos,
  uploadSelectedIntakePhoto,
} from "@/components/forms/intakePhotoUploadClient";
import { CustomerSearchPicker } from "@/components/forms/CustomerSearchPicker";
import { CustomerInformationReminder } from "@/components/customers/CustomerInformationReminder";
import { VinDecodePanel } from "@/components/forms/VinDecodePanel";
import { FindMotorcycleByVin } from "@/components/forms/FindMotorcycleByVin";

import { CREATE_INTAKE_PHOTO_SLOTS, PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import {
  CREATE_WORK_ORDER_WIZARD_STEPS,
  canNavigateToWizardStep,
  canProceedFromWizardStep,
  canSubmitCreateWorkOrderWizard,
} from "@/lib/forms/createWorkOrderWizard";
import { stripIntakePhotoFields } from "@/lib/forms/intakeFormData";
import {
  formatServiceLineSummary,
  type ServiceLineDraft,
} from "@/lib/forms/serviceLines";
import {
  SHOP_HOURLY_RATE,
  isFlatRateService,
  suggestedPriceFromLabourHours,
} from "@/lib/pricing/shopRate";
import { toFormErrorMessage } from "@/lib/services/errors";
import { formatDateTime, parseShopLocalDateTimeInput } from "@/lib/datetime/format";

type Props = {
  customers: Customer[];
  motorcycles: MotorcycleWithCustomer[];
  services: Service[];
  technicians: TechnicianOption[];
  initialCustomerId?: string;
  initialMotorcycleId?: string;
};

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const INPUT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const NAV_BTN_CLASS = "btn min-h-12 min-w-[8rem] px-6 text-base sm:min-h-14 sm:text-lg";

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
  const [optionalIntakePhotos, setOptionalIntakePhotos] = useState<File[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<WorkOrderFormState | null>(null);
  const [loadedMotorcycles, setLoadedMotorcycles] = useState<MotorcycleWithCustomer[]>(
    []
  );
  const [, startBikeLoad] = useTransition();

  const motorcycleOptions = useMemo(() => {
    const byId = new Map<string, MotorcycleWithCustomer>();
    for (const bike of motorcycles) byId.set(bike.motorcycle_id, bike);
    for (const bike of loadedMotorcycles) byId.set(bike.motorcycle_id, bike);
    return [...byId.values()];
  }, [motorcycles, loadedMotorcycles]);

  const recoveryWorkOrderId = recovery?.workOrderId ?? null;
  const missingCategories = recovery?.missingCategories ?? [];
  const isRecovery = Boolean(recoveryWorkOrderId && missingCategories.length > 0);

  const resolvedInitialCustomerId =
    initialCustomerId ||
    motorcycles.find((bike) => bike.motorcycle_id === initialMotorcycleId)?.customer_id ||
    "";

  const [customerId, setCustomerId] = useState(resolvedInitialCustomerId);
  const [motorcycleId, setMotorcycleId] = useState(initialMotorcycleId);
  const [mileage, setMileage] = useState("");
  const [estimatedCompletion, setEstimatedCompletion] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [serviceLines, setServiceLines] = useState<Record<string, ServiceLineDraft>>({});
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

  const [knownCustomers, setKnownCustomers] = useState(customers);

  const bikesForCustomer = useMemo(() => {
    if (!customerId) return [];
    return motorcycleOptions.filter((bike) => bike.customer_id === customerId);
  }, [customerId, motorcycleOptions]);

  const groupedServices = useMemo(() => groupServicesByCategory(services), [services]);

  const intakeComplete = allRequiredIntakeSelected(intakePhotos, ALL_REQUIRED);
  const stepId = CREATE_WORK_ORDER_WIZARD_STEPS[stepIndex].id;
  const isLastStep = stepId === "review";

  const selectedCustomer = knownCustomers.find((c) => c.customer_id === customerId);
  const selectedBike = motorcycleOptions.find(
    (bike) => bike.motorcycle_id === motorcycleId
  );

  function mergeMotorcycleOptions(rows: Motorcycle[], customer: Customer | null) {
    setLoadedMotorcycles((prev) => {
      const byId = new Map(prev.map((bike) => [bike.motorcycle_id, bike]));
      for (const row of rows) {
        const existing = byId.get(row.motorcycle_id);
        byId.set(row.motorcycle_id, {
          ...row,
          customer:
            existing?.customer ??
            (customer
              ? {
                  first_name: customer.first_name,
                  last_name: customer.last_name,
                }
              : null),
        });
      }
      return [...byId.values()];
    });
  }

  function handleCustomerChange(nextCustomerId: string, customer: Customer | null) {
    setCustomerId(nextCustomerId);
    setMotorcycleId("");
    setMaxReachedIndex(0);
    if (customer) {
      setKnownCustomers((prev) => {
        if (prev.some((c) => c.customer_id === customer.customer_id)) {
          return prev;
        }
        return [...prev, customer];
      });
    }
    if (!nextCustomerId) return;
    startBikeLoad(async () => {
      try {
        const bikes = await listMotorcyclesForCustomerAction(nextCustomerId);
        mergeMotorcycleOptions(bikes, customer);
      } catch {
        // Motorcycle step can still offer create-bike if none are loaded.
      }
    });
  }
  const selectedTech = technicians.find((tech) => tech.user_id === primaryTechnicianId);
  const selectedServices = services.filter((service) =>
    selectedServiceIds.includes(service.service_id)
  );

  const stepData = {
    customerId,
    motorcycleId,
    mileage,
    estimatedCompletion,
    selectedServiceIds,
    intakeComplete,
  };

  const canProceed = canProceedFromWizardStep(stepId, stepData);

  useEffect(() => {
    if (!resolvedInitialCustomerId) return;
    let cancelled = false;
    startBikeLoad(async () => {
      try {
        const bikes = await listMotorcyclesForCustomerAction(resolvedInitialCustomerId);
        if (cancelled) return;
        const customer =
          knownCustomers.find((c) => c.customer_id === resolvedInitialCustomerId) ?? null;
        mergeMotorcycleOptions(bikes, customer);
      } catch {
        // Deep-linked customer may still proceed once bikes are created.
      }
    });
    return () => {
      cancelled = true;
    };
    // Intentionally once for deep-link preload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedInitialCustomerId]);

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
    const next = Math.min(stepIndex + 1, CREATE_WORK_ORDER_WIZARD_STEPS.length - 1);
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
        setClientError(created.error ?? "Could not create the work order. Try again.");
        return;
      }

      const failed: PhotoCategory[] = [];
      for (const category of ALL_REQUIRED) {
        const original = intakePhotos[category];
        if (!(original instanceof File) || original.size === 0) {
          failed.push(category);
          continue;
        }

        const uploaded = await uploadSelectedIntakePhoto(
          created.workOrderId,
          original,
          category
        );
        if (!uploaded) failed.push(category);
      }

      if (failed.length > 0) {
        const labels = failed.map((c) => PHOTO_CATEGORY_LABELS[c] ?? c).join(", ");
        setRecovery({
          error: `${toFormErrorMessage(new Error("INTAKE_PHOTOS_PARTIAL"))} Missing: ${labels}.`,
          workOrderId: created.workOrderId,
          workOrderNumber: created.workOrderNumber,
          missingCategories: failed,
        });
        return;
      }

      const optionalFailures = await uploadOptionalIntakePhotos(
        created.workOrderId,
        optionalIntakePhotos
      );
      router.push(intakeContractHref(created.workOrderId, optionalFailures));
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
        optionalPhotos={optionalIntakePhotos}
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
          estimatedCompletion,
          selectedServiceIds,
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
      <input type="hidden" name="mileage" value={mileage} />
      <input type="hidden" name="estimated_completion" value={estimatedCompletion} />
      <input type="hidden" name="internal_notes" value={internalNotes} />
      <input type="hidden" name="primary_technician_id" value={primaryTechnicianId} />
      {selectedServiceIds.map((id) => (
        <input key={id} type="hidden" name="service_ids" value={id} />
      ))}
      {selectedServiceIds.map((id) => {
        const line = serviceLines[id];
        if (!line) return null;
        return (
          <span key={`line-${id}`}>
            <input type="hidden" name={`service_note_${id}`} value={line.note} />
            <input type="hidden" name={`service_labour_${id}`} value={line.labourHours} />
            <input type="hidden" name={`service_price_${id}`} value={line.price} />
          </span>
        );
      })}

      {stepId === "customer" ? (
        <section className="intake-wizard-panel">
          <h2 className="intake-wizard-panel-title">Customer</h2>
          <p className="intake-wizard-panel-lede">Who owns the bike for this visit?</p>
          <div className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Customer <span className="ml-1 text-red-600">*</span>
            </span>
            <CustomerSearchPicker
              value={customerId}
              initialCustomers={knownCustomers}
              onChange={handleCustomerChange}
              required
            />
            <span className="mt-1 block text-xs text-[var(--status-neutral)]">
              Search by name, email, or phone. Need a new customer?{" "}
              <Link href="/customers/new" className="underline underline-offset-2">
                Create one first
              </Link>
              .
            </span>
            {selectedCustomer ? (
              <CustomerInformationReminder
                phone={selectedCustomer.phone}
                email={selectedCustomer.email}
                address={selectedCustomer.address}
                dateOfBirth={selectedCustomer.date_of_birth}
                editHref={`/customers/${selectedCustomer.customer_id}#edit-customer`}
                openInNewTab
                className="mt-3"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {stepId === "motorcycle" ? (
        <section className="intake-wizard-panel">
          <h2 className="intake-wizard-panel-title">Motorcycle</h2>
          <p className="intake-wizard-panel-lede">
            Customer:{" "}
            <span className="font-medium text-foreground">
              {selectedCustomer
                ? `${selectedCustomer.last_name}, ${selectedCustomer.first_name}`
                : "—"}
            </span>
          </p>
          {selectedCustomer ? (
            <CustomerInformationReminder
              phone={selectedCustomer.phone}
              email={selectedCustomer.email}
              address={selectedCustomer.address}
              dateOfBirth={selectedCustomer.date_of_birth}
              editHref={`/customers/${selectedCustomer.customer_id}#edit-customer`}
              openInNewTab
              className="mb-4"
            />
          ) : null}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
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
            <span className="mt-1 block text-xs text-[var(--status-neutral)]">
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
              This motorcycle has {outstanding.length} outstanding recommendation
              {outstanding.length === 1 ? "" : "s"} from previous visits (pending,
              deferred, or declined). Review them on the bike profile after creating this
              work order.
            </p>
          ) : null}
        </section>
      ) : null}

      {stepId === "visit" ? (
        <section className="intake-wizard-panel">
          <h2 className="intake-wizard-panel-title">Visit details</h2>
          <p className="intake-wizard-panel-lede">
            Mileage, services, and technician. Square invoicing is created later from the
            work order Billing panel.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">
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
              <span className="mb-1.5 block text-sm font-medium text-foreground">
                Estimated completion <span className="ml-1 text-red-600">*</span>
              </span>
              <input
                className={SELECT_CLASS}
                type="datetime-local"
                value={estimatedCompletion}
                onChange={(event) => setEstimatedCompletion(event.target.value)}
                required
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Internal notes
            </span>
            <textarea
              className="min-h-24 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]"
              rows={3}
              value={internalNotes}
              onChange={(event) => setInternalNotes(event.target.value)}
            />
          </label>

          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold text-foreground">
              Services <span className="ml-1 text-red-600">*</span>
            </h3>
            <p className="text-sm text-[var(--status-neutral)]">
              Select at least one service for this visit. Labour jobs: enter hours (price
              defaults to × ${SHOP_HOURLY_RATE}/h). Storage is flat-rate — enter price
              only. Notes are optional.
            </p>
            {services.length === 0 ? (
              <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-6 text-sm text-[var(--status-neutral)]">
                No active services in the catalogue.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {groupedServices.map(({ category, services: categoryServices }) => (
                  <div key={category}>
                    <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
                      {category}
                    </h4>
                    <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-white">
                      {categoryServices.map((service) => {
                        const checked = selectedServiceIds.includes(service.service_id);
                        const line = serviceLines[service.service_id];
                        const flatRate = isFlatRateService(service);
                        const fixedCataloguePrice =
                          service.standard_price != null &&
                          Number.isFinite(service.standard_price);
                        const useHourlyRate = !flatRate && !fixedCataloguePrice;
                        return (
                          <li key={service.service_id} className="px-4 py-3">
                            <label className="flex min-h-11 cursor-pointer items-start gap-3">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSelectedServiceIds((prev) => {
                                    if (checked) {
                                      setServiceLines((lines) => {
                                        const next = { ...lines };
                                        delete next[service.service_id];
                                        return next;
                                      });
                                      return prev.filter(
                                        (id) => id !== service.service_id
                                      );
                                    }
                                    setServiceLines((lines) => ({
                                      ...lines,
                                      [service.service_id]: {
                                        note: "",
                                        labourHours: "",
                                        price: fixedCataloguePrice
                                          ? String(service.standard_price)
                                          : "",
                                      },
                                    }));
                                    return [...prev, service.service_id];
                                  });
                                }}
                                className="mt-1 h-4 w-4"
                              />
                              <span>
                                <span className="block font-medium text-foreground">
                                  {service.name}
                                </span>
                                {!checked ? (
                                  <span className="block text-sm text-[var(--status-neutral)]">
                                    {flatRate
                                      ? "Flat rate — enter price"
                                      : fixedCataloguePrice
                                        ? `$${service.standard_price}`
                                        : `$${SHOP_HOURLY_RATE}/h — enter hours for this bike`}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                            {checked && line ? (
                              <div className="mt-3 ml-7 grid gap-3 sm:grid-cols-2">
                                {!flatRate ? (
                                  <label className="block">
                                    <span className="mb-1 block text-xs font-medium text-foreground">
                                      Hours
                                    </span>
                                    <input
                                      className={INPUT_CLASS}
                                      type="number"
                                      min={0}
                                      step={0.1}
                                      inputMode="decimal"
                                      value={line.labourHours}
                                      placeholder="Hours for this bike"
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setServiceLines((prev) => ({
                                          ...prev,
                                          [service.service_id]: {
                                            ...prev[service.service_id],
                                            labourHours: value,
                                            ...(useHourlyRate
                                              ? {
                                                  price:
                                                    suggestedPriceFromLabourHours(value),
                                                }
                                              : {}),
                                          },
                                        }));
                                      }}
                                    />
                                  </label>
                                ) : null}
                                <label
                                  className={`block${flatRate ? " sm:col-span-2" : ""}`}
                                >
                                  <span className="mb-1 block text-xs font-medium text-foreground">
                                    Price
                                    {useHourlyRate ? (
                                      <span className="font-normal text-[var(--status-neutral)]">
                                        {" "}
                                        (${SHOP_HOURLY_RATE}/h)
                                      </span>
                                    ) : null}
                                  </span>
                                  <input
                                    className={INPUT_CLASS}
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    inputMode="decimal"
                                    value={line.price}
                                    placeholder={
                                      flatRate
                                        ? "Flat storage price"
                                        : "Price for this bike"
                                    }
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setServiceLines((prev) => ({
                                        ...prev,
                                        [service.service_id]: {
                                          ...prev[service.service_id],
                                          price: value,
                                        },
                                      }));
                                    }}
                                  />
                                </label>
                                <label className="block sm:col-span-2">
                                  <span className="mb-1 block text-xs font-medium text-foreground">
                                    Note
                                  </span>
                                  <textarea
                                    className="min-h-20 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]"
                                    rows={2}
                                    value={line.note}
                                    placeholder="Note for this service…"
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setServiceLines((prev) => ({
                                        ...prev,
                                        [service.service_id]: {
                                          ...prev[service.service_id],
                                          note: value,
                                        },
                                      }));
                                    }}
                                  />
                                </label>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Primary technician
            </span>
            <select
              className={SELECT_CLASS}
              value={primaryTechnicianId}
              onChange={(event) => setPrimaryTechnicianId(event.target.value)}
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
        className={stepId === "photos" ? "intake-wizard-panel" : "sr-only"}
        aria-hidden={stepId !== "photos"}
      >
        <div className="intake-photo-header">
          <div>
            <h2 className="intake-wizard-panel-title">
              Intake photos <span className="text-red-600">*</span>
            </h2>
            <p className="intake-wizard-panel-lede mt-1">
              Capture all six required photos before continuing. Add any extra photos
              below if they help document the motorcycle.
            </p>
          </div>
          {stepId === "photos" ? (
            <div
              className={`intake-photo-progress${intakeComplete ? " is-complete" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span className="intake-photo-progress-meter">{selectedPhotoCount}/6</span>
              {intakeComplete ? "All set" : "photos selected"}
            </div>
          ) : null}
        </div>
        <IntakePhotoSlots
          value={intakePhotos}
          htmlRequired={false}
          disabled={stepId !== "photos" || submitting}
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
        <OptionalIntakePhotos
          value={optionalIntakePhotos}
          disabled={stepId !== "photos" || submitting}
          onChange={(next) => {
            if (stepId !== "photos") return;
            setOptionalIntakePhotos(next);
            setClientError(null);
          }}
        />
      </section>

      {stepId === "review" ? (
        <section className="intake-wizard-panel">
          <h2 className="intake-wizard-panel-title">Review & create</h2>
          <p className="intake-wizard-panel-lede">
            Confirm details, then create the work order and upload intake photos.
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
            <ReviewCard label="Mileage" value={mileage || "—"} />
            <ReviewCard
              label="Estimated completion"
              value={
                estimatedCompletion
                  ? formatDateTime(parseShopLocalDateTimeInput(estimatedCompletion)) ||
                    estimatedCompletion
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
                  ? selectedServices
                      .map((s) => {
                        const line = serviceLines[s.service_id];
                        return formatServiceLineSummary({
                          name: s.name,
                          labourHours: line?.labourHours ?? "",
                          price: line?.price ?? "",
                          note: line?.note ?? "",
                        });
                      })
                      .join("\n")
                  : "None selected"
              }
              muted={selectedServices.length === 0}
              wide
            />
            <ReviewCard
              label="Intake photos"
              value={
                intakeComplete
                  ? `All 6 required ready${
                      optionalIntakePhotos.length > 0
                        ? ` + ${optionalIntakePhotos.length} extra`
                        : ""
                    }`
                  : "Incomplete"
              }
              ok={intakeComplete}
              wide
            />
            {internalNotes.trim() ? (
              <ReviewCard label="Internal notes" value={internalNotes} wide />
            ) : null}
          </div>
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
                  estimatedCompletion,
                  selectedServiceIds,
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
              }${isComplete ? " is-complete" : ""}${isUpcoming ? " is-upcoming" : ""}`}
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
        className={`intake-review-card-value whitespace-pre-line${muted ? " is-muted" : ""}${
          ok ? " is-ok" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
