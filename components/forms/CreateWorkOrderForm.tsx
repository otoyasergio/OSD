"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { WorkOrderFormState } from "@/app/(app)/work_orders/actions";
import type { Customer } from "@/lib/services/customers";
import type { MotorcycleWithCustomer } from "@/lib/services/motorcycles";
import {
  groupServicesByCategory,
  type Service,
} from "@/lib/services/serviceCatalogue";
import type { TechnicianOption } from "@/lib/services/workOrders";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

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

  const resolvedInitialCustomerId =
    initialCustomerId ||
    motorcycles.find((bike) => bike.motorcycle_id === initialMotorcycleId)
      ?.customer_id ||
    "";

  const [customerId, setCustomerId] = useState(resolvedInitialCustomerId);
  const [motorcycleId, setMotorcycleId] = useState(initialMotorcycleId);

  const bikesForCustomer = useMemo(() => {
    if (!customerId) return [];
    return motorcycles.filter((bike) => bike.customer_id === customerId);
  }, [customerId, motorcycles]);

  const groupedServices = useMemo(
    () => groupServicesByCategory(services),
    [services]
  );

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-6">
      <FormError message={state.error} />

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

      <div>
        <SubmitButton label="Create work order" pendingLabel="Creating…" />
      </div>
    </form>
  );
}
