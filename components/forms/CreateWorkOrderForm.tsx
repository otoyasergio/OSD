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
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  IntakePhotoSlots,
  allRequiredIntakeSelected,
  type IntakePhotoSelection,
} from "@/components/forms/IntakePhotoSlots";
import { IntakePhotoRecoveryForm } from "@/components/forms/IntakePhotoRecoveryForm";
import { CREATE_INTAKE_PHOTO_SLOTS } from "@/lib/status/labels";

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
  const [outstanding, setOutstanding] = useState<OutstandingRecommendation[]>(
    []
  );

  const bikesForCustomer = useMemo(() => {
    if (!customerId) return [];
    return motorcycles.filter((bike) => bike.customer_id === customerId);
  }, [customerId, motorcycles]);

  const groupedServices = useMemo(
    () => groupServicesByCategory(services),
    [services]
  );

  const intakeComplete = allRequiredIntakeSelected(intakePhotos, ALL_REQUIRED);

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
      onSubmit={(event) => {
        if (!allRequiredIntakeSelected(intakePhotos, ALL_REQUIRED)) {
          event.preventDefault();
          setClientError(
            "Add all six required intake photos before creating the work order."
          );
        }
      }}
    >
      <FormError message={state.error ?? clientError} />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-zinc-900">Customer & bike</h2>

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
            }}
            required
          >
            <option value="">Select a customer</option>
            {customers.map((customer) => (
              <option key={customer.customer_id} value={customer.customer_id}>
                {customer.last_name}, {customer.first_name}
                {customer.phone ? ` · ${customer.phone}` : ""}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-zinc-500">
            Need a new customer?{" "}
            <Link href="/customers/new" className="underline underline-offset-2">
              Create one first
            </Link>
            .
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            Motorcycle <span className="ml-1 text-red-600">*</span>
          </span>
          <select
            className={SELECT_CLASS}
            name="motorcycle_id"
            value={motorcycleId}
            onChange={(event) => setMotorcycleId(event.target.value)}
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
            This motorcycle has {outstanding.length} outstanding recommendation
            {outstanding.length === 1 ? "" : "s"} from previous visits
            (pending, deferred, or declined). Review them on the bike profile
            after creating this work order.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-zinc-900">Visit details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="External invoice #"
            name="external_invoice_number"
            placeholder="From invoicing software"
          />
          <TextField label="Mileage" name="mileage" type="number" />
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Estimated completion
            </span>
            <input
              className={SELECT_CLASS}
              name="estimated_completion"
              type="datetime-local"
            />
          </label>
        </div>
        <TextAreaField label="Internal notes" name="internal_notes" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">Services</h2>
        <p className="text-sm text-zinc-600">
          Selected services become approved jobs on the work order.
        </p>
        {services.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-600">
            No active services in the catalogue.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groupedServices.map(({ category, services: categoryServices }) => (
              <div key={category}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                  {category}
                </h3>
                <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
                  {categoryServices.map((service) => (
                    <li key={service.service_id}>
                      <label className="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3">
                        <input
                          type="checkbox"
                          name="service_ids"
                          value={service.service_id}
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
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">Primary technician</h2>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            Technician
          </span>
          <select className={SELECT_CLASS} name="primary_technician_id" defaultValue="">
            <option value="">Unassigned</option>
            {technicians.map((tech) => (
              <option key={tech.user_id} value={tech.user_id}>
                {tech.first_name} {tech.last_name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">
            Intake photos <span className="text-red-600">*</span>
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Capture all six angles before creating the work order. On iPad, tap
            a slot to use the camera.
          </p>
        </div>
        <IntakePhotoSlots
          value={intakePhotos}
          onChange={(next) => {
            setIntakePhotos(next);
            setClientError(null);
          }}
        />
        {!intakeComplete ? (
          <p className="text-sm text-zinc-500">
            {
              Object.values(intakePhotos).filter(
                (file) => file instanceof File && file.size > 0
              ).length
            }
            /6 selected
          </p>
        ) : (
          <p className="text-sm text-emerald-700">All six intake photos ready.</p>
        )}
      </section>

      <div>
        <SubmitButton
          label="Create work order"
          pendingLabel="Creating & uploading…"
        />
      </div>
    </form>
  );
}
