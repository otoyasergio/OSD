"use client";

import dynamic from "next/dynamic";
import type { Customer } from "@/lib/services/customers";
import type { MotorcycleWithCustomer } from "@/lib/services/motorcycles";
import type { Service } from "@/lib/services/serviceCatalogue";

const Form = dynamic(
  () =>
    import("@/components/forms/CreateWorkOrderForm").then(
      (mod) => mod.CreateWorkOrderForm
    ),
  {
    loading: () => (
      <div
        className="flex min-h-[320px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-sm text-[var(--status-neutral)]"
        aria-busy="true"
      >
        Loading intake form…
      </div>
    ),
    ssr: false,
  }
);

type TechnicianOption = {
  user_id: string;
  first_name: string;
  last_name: string;
};

type Props = {
  customers: Customer[];
  motorcycles: MotorcycleWithCustomer[];
  services: Service[];
  technicians: TechnicianOption[];
  initialCustomerId?: string;
  initialMotorcycleId?: string;
};

export function CreateWorkOrderFormLazy(props: Props) {
  return <Form {...props} />;
}
