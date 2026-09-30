"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createWorkOrderOnlyAction,
  getLastRecordedMileageAction,
  type WorkOrderFormState,
} from "@/app/(app)/work_orders/actions";
import { getOutstandingRecommendationsAction } from "@/app/(app)/work_orders/recommendation-actions";
import { listMotorcyclesForCustomerAction } from "@/app/(app)/motorcycles/actions";
import type { Customer } from "@/lib/services/customers";
import type { Motorcycle, MotorcycleWithCustomer } from "@/lib/services/motorcycles";
import type { OutstandingRecommendation } from "@/lib/services/recommendations";
import {
  filterIntakeServiceGroups,
  groupIntakeServicesByCategory,
  type Service,
} from "@/lib/services/serviceCatalogueShared";
import type { LastRecordedMileage, TechnicianOption } from "@/lib/services/workOrders";
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
import { MileageUnitToggle } from "@/components/forms/MileageUnitToggle";

import { CREATE_INTAKE_PHOTO_SLOTS, PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import {
  CREATE_WORK_ORDER_WIZARD_STEPS,
  canNavigateToWizardStep,
  canProceedFromWizardStep,
  canSubmitCreateWorkOrderWizard,
} from "@/lib/forms/createWorkOrderWizard";
import { stripIntakePhotoFields } from "@/lib/forms/intakeFormData";
import { mapWithConcurrency } from "@/lib/forms/mapWithConcurrency";
import {
  createIntakeServiceLineDraft,
  formatServiceLineSummary,
  hasValidServiceLinePrice,
  serviceLineSubtotalDollars,
  type ServiceLineDraft,
} from "@/lib/forms/serviceLines";
import { estimateTotalsWithHst, HST_PERCENT } from "@/lib/pricing/hst";
import {
  SHOP_HOURLY_RATE,
  isFlatRateService,
  suggestedPriceFromLabourHours,
} from "@/lib/pricing/shopRate";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  formatDateTime,
  nextShopBusinessCompletionValue,
  parseShopLocalDateTimeInput,
} from "@/lib/datetime/format";
import {
  formatMileage,
  isMileageLowerThanPrevious,
  normalizeMileageUnit,
  type MileageUnit,
} from "@/lib/mileage/format";
import { formatDate } from "@/lib/datetime/format";

type Props = {
  customers: Customer[];
  motorcycles: MotorcycleWithCustomer[];
  services: Service[];
  technicians: TechnicianOption[];
  initialCustomerId?: string;
  initialMotorcycleId?: string;
  closureDates: string[];
};

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const INPUT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const NAV_BTN_CLASS = "btn min-h-12 min-w-[8rem] px-6 text-base sm:min-h-14 sm:text-lg";

const CAD_CURRENCY = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

const ALL_REQUIRED = CREATE_INTAKE_PHOTO_SLOTS.map((s) => s.category);
const PHOTO_STEP_INDEX = CREATE_WORK_ORDER_WIZARD_STEPS.findIndex(
  (step) => step.id === "photos"
);
const REVIEW_STEP_INDEX = CREATE_WORK_ORDER_WIZARD_STEPS.findIndex(
  (step) => step.id === "review"
);
const DEFAULT_OPEN_SERVICE_CATEGORY = "Inspection & Diagnostics";
const REQUIRED_PHOTO_UPLOAD_CONCURRENCY = 2;

function newMotorcycleForIntakeHref(customerId: string): string {
  if (!customerId) return "/motorcycles/new";
  const intakePath = `/work_orders/new?customer_id=${encodeURIComponent(customerId)}`;
  return `/motorcycles/new?customer_id=${encodeURIComponent(
    customerId
  )}&return_to=${encodeURIComponent(intakePath)}`;
}

export function CreateWorkOrderForm({
  customers,
  motorcycles,
  services,
  technicians,
  initialCustomerId = "",
  initialMotorcycleId = "",
  closureDates,
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
  const customerIdRef = useRef(resolvedInitialCustomerId);
  const bikeLoadRequestRef = useRef(0);
  const [workOrderNumber, setWorkOrderNumber] = useState("");
  const [mileage, setMileage] = useState("");
  const [mileageUnit, setMileageUnit] = useState<MileageUnit>(() =>
    normalizeMileageUnit(
      motorcycles.find((bike) => bike.motorcycle_id === initialMotorcycleId)
        ?.odometer_unit
    )
  );
  const [estimatedCompletion, setEstimatedCompletion] = useState(() =>
    nextShopBusinessCompletionValue(new Date(), closureDates)
  );
  const [internalNotes, setInternalNotes] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [openServiceCategories, setOpenServiceCategories] = useState<string[]>([
    DEFAULT_OPEN_SERVICE_CATEGORY,
  ]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [serviceLines, setServiceLines] = useState<Record<string, ServiceLineDraft>>({});
  const [primaryTechnicianId, setPrimaryTechnicianId] = useState("");
  const [outstandingFetch, setOutstandingFetch] = useState<{
    motorcycleId: string;
    rows: OutstandingRecommendation[];
  } | null>(null);
  const [lastMileageFetch, setLastMileageFetch] = useState<{
    motorcycleId: string;
    row: LastRecordedMileage | null;
  } | null>(null);
  // Only show recommendations fetched for the currently selected bike; a
  // stale or absent fetch reads as empty.
  const outstanding =
    motorcycleId && outstandingFetch?.motorcycleId === motorcycleId
      ? outstandingFetch.rows
      : [];
  const lastRecordedMileage =
    motorcycleId && lastMileageFetch?.motorcycleId === motorcycleId
      ? lastMileageFetch.row
      : null;
  const lastMileageLoading =
    Boolean(motorcycleId) && lastMileageFetch?.motorcycleId !== motorcycleId;

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

  const groupedServices = useMemo(
    () => groupIntakeServicesByCategory(services),
    [services]
  );
  const visibleGroupedServices = useMemo(
    () => filterIntakeServiceGroups(groupedServices, serviceSearch, selectedServiceIds),
    [groupedServices, selectedServiceIds, serviceSearch]
  );
  const visibleServiceCount = visibleGroupedServices.reduce(
    (count, group) => count + group.services.length,
    0
  );
  const serviceSearchActive = Boolean(serviceSearch.trim());

  const intakeComplete = allRequiredIntakeSelected(intakePhotos, ALL_REQUIRED);
  const stepId = CREATE_WORK_ORDER_WIZARD_STEPS[stepIndex].id;
  const isLastStep = stepId === "review";

  const selectedCustomer = knownCustomers.find((c) => c.customer_id === customerId);
  const selectedBike = motorcycleOptions.find(
    (bike) => bike.motorcycle_id === motorcycleId
  );

  function mergeMotorcycleOptions(rows: Motorcycle[], customer: Customer | null) {
    const currentBike = rows.find((bike) => bike.motorcycle_id === motorcycleId);
    if (currentBike) {
      setMileageUnit(normalizeMileageUnit(currentBike.odometer_unit));
    }
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
    customerIdRef.current = nextCustomerId;
    const requestId = ++bikeLoadRequestRef.current;
    setCustomerId(nextCustomerId);
    setMotorcycleId("");
    setMileageUnit("km");
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
        if (
          requestId !== bikeLoadRequestRef.current ||
          customerIdRef.current !== nextCustomerId
        ) {
          return;
        }
        mergeMotorcycleOptions(bikes, customer);
        if (bikes.length === 1) {
          setMotorcycleId(bikes[0].motorcycle_id);
          setMileageUnit(normalizeMileageUnit(bikes[0].odometer_unit));
        }
      } catch {
        // Motorcycle step can still offer create-bike if none are loaded.
      }
    });
  }

  function handleMotorcycleChange(nextMotorcycleId: string) {
    setMotorcycleId(nextMotorcycleId);
    const bike = motorcycleOptions.find(
      (option) => option.motorcycle_id === nextMotorcycleId
    );
    setMileageUnit(normalizeMileageUnit(bike?.odometer_unit));
    setMaxReachedIndex((prev) => Math.min(prev, 1));
  }
  const selectedTech = technicians.find((tech) => tech.user_id === primaryTechnicianId);
  const selectedServices = services.filter((service) =>
    selectedServiceIds.includes(service.service_id)
  );
  const missingPriceServiceIds = selectedServiceIds.filter(
    (serviceId) => !hasValidServiceLinePrice(serviceLines[serviceId])
  );
  const servicePricingComplete =
    selectedServiceIds.length > 0 && missingPriceServiceIds.length === 0;
  const serviceSubtotal = serviceLineSubtotalDollars(
    selectedServiceIds.map((serviceId) => serviceLines[serviceId])
  );
  const intakeEstimate = estimateTotalsWithHst(serviceSubtotal);
  const mileageLowerThanLast = lastRecordedMileage
    ? isMileageLowerThanPrevious({
        currentMileage: mileage,
        currentUnit: mileageUnit,
        previousMileage: lastRecordedMileage.mileage,
        previousUnit: lastRecordedMileage.mileage_unit,
      })
    : false;

  const stepData = {
    customerId,
    motorcycleId,
    workOrderNumber,
    mileage,
    estimatedCompletion,
    selectedServiceIds,
    servicePricingComplete,
    intakeComplete,
  };

  const canProceed = canProceedFromWizardStep(stepId, stepData);

  useEffect(() => {
    if (!resolvedInitialCustomerId) return;
    let cancelled = false;
    const requestId = ++bikeLoadRequestRef.current;
    startBikeLoad(async () => {
      try {
        const bikes = await listMotorcyclesForCustomerAction(resolvedInitialCustomerId);
        if (
          cancelled ||
          requestId !== bikeLoadRequestRef.current ||
          customerIdRef.current !== resolvedInitialCustomerId
        ) {
          return;
        }
        const customer =
          knownCustomers.find((c) => c.customer_id === resolvedInitialCustomerId) ?? null;
        mergeMotorcycleOptions(bikes, customer);
        if (!initialMotorcycleId && bikes.length === 1) {
          setMotorcycleId(bikes[0].motorcycle_id);
          setMileageUnit(normalizeMileageUnit(bikes[0].odometer_unit));
        }
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
    void Promise.all([
      getOutstandingRecommendationsAction(motorcycleId).catch(() => []),
      getLastRecordedMileageAction(motorcycleId).catch(() => null),
    ]).then(([rows, lastMileage]) => {
      if (cancelled) return;
      setOutstandingFetch({ motorcycleId, rows });
      setLastMileageFetch({ motorcycleId, row: lastMileage });
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

      const uploadResults = await mapWithConcurrency(
        ALL_REQUIRED,
        REQUIRED_PHOTO_UPLOAD_CONCURRENCY,
        async (category) => {
          const original = intakePhotos[category];
          if (!(original instanceof File) || original.size === 0) return false;
          return uploadSelectedIntakePhoto(created.workOrderId!, original, category);
        }
      );
      const failed = ALL_REQUIRED.filter((_, index) => !uploadResults[index]);

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
          workOrderNumber,
          mileage,
          estimatedCompletion,
          selectedServiceIds,
          servicePricingComplete,
          intakeComplete,
        });
        if (!ok) {
          setClientError(
            isLastStep
              ? "Complete every required step, including the Wix work order number and all six intake photos, before creating the work order."
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
      <input type="hidden" name="work_order_number" value={workOrderNumber.trim()} />
      <input type="hidden" name="mileage" value={mileage} />
      <input type="hidden" name="mileage_unit" value={mileageUnit} />
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
              <Link
                href="/customers/new?return_to=%2Fwork_orders%2Fnew"
                className="underline underline-offset-2"
              >
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
              onChange={(event) => handleMotorcycleChange(event.target.value)}
              required
              disabled={!customerId}
            >
              <option value="">Select a motorcycle</option>
              {bikesForCustomer.map((bike) => (
                <option key={bike.motorcycle_id} value={bike.motorcycle_id}>
                  {bike.year} {bike.make} {bike.model}
                  {bike.plate_number
                    ? ` · Plate ${bike.plate_number}`
                    : " · Missing plate"}
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
                href={newMotorcycleForIntakeHref(customerId)}
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
                handleMotorcycleChange(id);
                router.refresh();
              }}
            />
          ) : null}
          {selectedBike && !selectedBike.plate_number ? (
            <p
              role="status"
              className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              Plate number missing — ask the customer for it and add it to the motorcycle
              record.{" "}
              <Link
                href={`/motorcycles/${selectedBike.motorcycle_id}#edit-motorcycle`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Add plate
              </Link>
              . You can continue this intake without it.
            </p>
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
            Enter the Wix work order number first — that becomes the shop work order #.
            Then mileage, services, and technician. Square invoicing is created later from
            the work order Billing panel.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Wix work order # <span className="ml-1 text-red-600">*</span>
            </span>
            <input
              className={INPUT_CLASS}
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="e.g. WO-1042"
              value={workOrderNumber}
              onChange={(event) => setWorkOrderNumber(event.target.value)}
              required
            />
            <span className="mt-1 block text-xs text-[var(--status-neutral)]">
              Copy the number from Wix. We no longer assign work order numbers in the shop
              app.
            </span>
          </label>
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
                  Enter a whole odometer reading (no decimals).
                </span>
              ) : null}
              {lastMileageLoading ? (
                <span className="mt-1 block text-xs text-[var(--status-neutral)]">
                  Checking the last recorded reading…
                </span>
              ) : lastRecordedMileage ? (
                <span className="mt-1 block text-xs text-[var(--status-neutral)]">
                  Last recorded:{" "}
                  {formatMileage(
                    lastRecordedMileage.mileage,
                    lastRecordedMileage.mileage_unit
                  )}{" "}
                  on {formatDate(lastRecordedMileage.date_created)} ·{" "}
                  {lastRecordedMileage.work_order_number}
                </span>
              ) : motorcycleId ? (
                <span className="mt-1 block text-xs text-[var(--status-neutral)]">
                  No previous odometer reading recorded.
                </span>
              ) : null}
              {mileageLowerThanLast ? (
                <span
                  className="mt-1 block rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900"
                  role="alert"
                >
                  This is lower than the last recorded reading. Check the number and unit.
                </span>
              ) : null}
            </label>
            <MileageUnitToggle value={mileageUnit} onChange={setMileageUnit} />
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
              <span className="mt-1 block text-xs text-[var(--status-neutral)]">
                Defaults to the next open shop day at closing time. Edit as needed.
              </span>
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
              only. Notes are optional. All service and parts prices are before HST;
              {` ${HST_PERCENT}% HST`} is added to the invoice.
            </p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">
                  Find a service
                </span>
                <input
                  className={INPUT_CLASS}
                  type="search"
                  value={serviceSearch}
                  onChange={(event) => setServiceSearch(event.target.value)}
                  placeholder="Oil, tire, diagnostic…"
                  autoComplete="off"
                />
              </label>
              {serviceSearch ? (
                <button
                  type="button"
                  className="btn btn-secondary min-h-11"
                  onClick={() => setServiceSearch("")}
                >
                  Clear
                </button>
              ) : null}
            </div>
            {serviceSearch ? (
              <p className="text-xs text-[var(--status-neutral)]" role="status">
                {visibleServiceCount === 0
                  ? `No services match “${serviceSearch.trim()}”.`
                  : `${visibleServiceCount} service${visibleServiceCount === 1 ? "" : "s"} shown.`}
                {selectedServiceIds.length > 0 ? " Selected services stay visible." : ""}
              </p>
            ) : null}
            {services.length === 0 ? (
              <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-6 text-sm text-[var(--status-neutral)]">
                No active services in the catalogue.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {visibleGroupedServices.map(
                  ({ category, services: categoryServices }) => (
                    <details
                      key={category}
                      open={
                        serviceSearchActive || openServiceCategories.includes(category)
                      }
                      onToggle={(event) => {
                        if (serviceSearchActive) return;
                        const isOpen = event.currentTarget.open;
                        setOpenServiceCategories((current) => {
                          if (isOpen) {
                            return current.includes(category)
                              ? current
                              : [...current, category];
                          }
                          return current.filter((item) => item !== category);
                        });
                      }}
                      className="overflow-hidden rounded border border-[var(--border)] bg-white"
                    >
                      <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)] hover:bg-[var(--surface-muted)]">
                        <span>{category}</span>
                        <span className="text-xs font-medium normal-case tracking-normal">
                          {categoryServices.length} service
                          {categoryServices.length === 1 ? "" : "s"}
                        </span>
                      </summary>
                      <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                        {categoryServices.map((service) => {
                          const checked = selectedServiceIds.includes(service.service_id);
                          const line = serviceLines[service.service_id];
                          const priceMissing = checked && !hasValidServiceLinePrice(line);
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
                                        [service.service_id]:
                                          createIntakeServiceLineDraft({
                                            name: service.name,
                                            estimatedLabour: service.estimated_labour,
                                            standardPrice: service.standard_price,
                                          }),
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
                                                      suggestedPriceFromLabourHours(
                                                        value
                                                      ),
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
                                      Price before HST
                                      {useHourlyRate ? (
                                        <span className="font-normal text-[var(--status-neutral)]">
                                          {" "}
                                          (${SHOP_HOURLY_RATE}/h)
                                        </span>
                                      ) : null}
                                    </span>
                                    <input
                                      className={`${INPUT_CLASS}${
                                        priceMissing
                                          ? " border-red-500 focus:border-red-600 focus:ring-red-200"
                                          : ""
                                      }`}
                                      type="number"
                                      min={0}
                                      step={0.01}
                                      inputMode="decimal"
                                      value={line.price}
                                      required
                                      aria-invalid={priceMissing}
                                      aria-describedby={
                                        priceMissing
                                          ? `service-price-error-${service.service_id}`
                                          : undefined
                                      }
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
                                    {priceMissing ? (
                                      <span
                                        id={`service-price-error-${service.service_id}`}
                                        className="mt-1 block text-xs font-medium text-red-700"
                                        role="alert"
                                      >
                                        Enter a price so the estimate is complete.
                                      </span>
                                    ) : null}
                                  </label>
                                  <details className="sm:col-span-2">
                                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-foreground underline-offset-2 hover:underline">
                                      {line.note.trim() ? "Edit note" : "+ Add note"}
                                    </summary>
                                    <label className="mt-1 block">
                                      <span className="mb-1 block text-xs font-medium text-foreground">
                                        Service note (optional)
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
                                  </details>
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )
                )}
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
        className="intake-wizard-panel"
        hidden={stepId !== "photos"}
        aria-hidden={stepId !== "photos"}
      >
        <div className="intake-photo-header">
          <div>
            <h2 className="intake-wizard-panel-title">
              Intake photos <span className="text-red-600">*</span>
            </h2>
            <p className="intake-wizard-panel-lede mt-1">
              Capture all six required photos before continuing. Add any extra photos
              below if they help document the motorcycle. The form moves to Review as soon
              as all six required photos are ready.
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
            if (allRequiredIntakeSelected(next, ALL_REQUIRED)) {
              setMaxReachedIndex((prev) => Math.max(prev, REVIEW_STEP_INDEX));
              setStepIndex(REVIEW_STEP_INDEX);
            } else {
              setMaxReachedIndex((prev) => Math.min(prev, PHOTO_STEP_INDEX));
              setStepIndex((prev) => Math.min(prev, PHOTO_STEP_INDEX));
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
            <ReviewCard label="Wix work order #" value={workOrderNumber.trim() || "—"} />
            <ReviewCard label="Mileage" value={formatMileage(mileage, mileageUnit)} />
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
              label={`Services (before ${HST_PERCENT}% HST)`}
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
            <ReviewPricingCard
              subtotalCents={intakeEstimate.subtotalCents}
              hstCents={intakeEstimate.hstCents}
              totalCents={intakeEstimate.totalCents}
              pricingComplete={servicePricingComplete}
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
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-secondary min-h-11"
              onClick={() => goToStep(PHOTO_STEP_INDEX)}
            >
              {optionalIntakePhotos.length > 0
                ? "Edit intake photos"
                : "Add optional extra photos"}
            </button>
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
                  workOrderNumber,
                  mileage,
                  estimatedCompletion,
                  selectedServiceIds,
                  servicePricingComplete,
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

function ReviewPricingCard({
  subtotalCents,
  hstCents,
  totalCents,
  pricingComplete,
}: {
  subtotalCents: number;
  hstCents: number;
  totalCents: number;
  pricingComplete: boolean;
}) {
  const money = (cents: number) => CAD_CURRENCY.format(cents / 100);

  return (
    <div className="intake-review-card is-wide">
      <div className="intake-review-card-label">Current service estimate</div>
      <dl className="mt-1 grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[var(--status-neutral)]">Services subtotal</dt>
          <dd className="font-semibold text-foreground">{money(subtotalCents)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[var(--status-neutral)]">HST ({HST_PERCENT}%)</dt>
          <dd className="font-semibold text-foreground">{money(hstCents)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-[var(--border)] pt-2 text-base">
          <dt className="font-bold text-foreground">Current total</dt>
          <dd className="font-bold text-foreground">{money(totalCents)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-[var(--status-neutral)]">
        Parts added after intake will update the subtotal, HST, and total.
      </p>
      {!pricingComplete ? (
        <p
          className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
          role="alert"
        >
          This estimate is incomplete. Return to Visit details and price every selected
          service before creating the work order.
        </p>
      ) : null}
    </div>
  );
}
