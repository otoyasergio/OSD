"use client";

import { useActionState } from "react";
import type { ServiceFormState } from "@/app/(app)/settings/services/actions";
import {
  SERVICE_PRICING_MODE_OPTIONS,
  type Service,
  type ServicePricingMode,
} from "@/lib/services/serviceCatalogueShared";
import { FormError, SELECT_CLASS, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type ServiceAction = (
  state: ServiceFormState,
  formData: FormData
) => Promise<ServiceFormState>;

function PricingModeSelect({ defaultValue }: { defaultValue: ServicePricingMode }) {
  return (
    <label className="block">
      <span className="field-label">Pricing mode</span>
      <select className={SELECT_CLASS} name="pricing_mode" defaultValue={defaultValue}>
        {SERVICE_PRICING_MODE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-[var(--status-neutral)]">
        Fixed package charges the standard price once; itemized bills labour and parts
        separately on V2 estimates.
      </span>
    </label>
  );
}

export function ServiceCreateForm({ action }: { action: ServiceAction }) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded border border-[var(--border)] bg-white p-4"
    >
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField label="Service name" name="name" required />
        <TextField label="Category" name="category" placeholder="e.g. Maintenance" />
        <TextField label="Standard price" name="standard_price" type="number" />
        <TextField
          label="Estimated labour (hours)"
          name="estimated_labour"
          type="number"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PricingModeSelect defaultValue="fixed_package" />
      </div>
      <div>
        <SubmitButton label="Add service" pendingLabel="Adding…" />
      </div>
    </form>
  );
}

export function ServiceEditForm({
  action,
  service,
  pricingMode = "fixed_package",
}: {
  action: ServiceAction;
  service: Service;
  pricingMode?: ServicePricingMode;
}) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-3 pt-3">
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Service name"
          name="name"
          required
          defaultValue={service.name}
        />
        <TextField
          label="Category"
          name="category"
          placeholder="e.g. Maintenance"
          defaultValue={service.category}
        />
        <TextField
          label="Standard price"
          name="standard_price"
          type="number"
          defaultValue={service.standard_price}
        />
        <TextField
          label="Estimated labour (hours)"
          name="estimated_labour"
          type="number"
          defaultValue={service.estimated_labour}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PricingModeSelect defaultValue={pricingMode} />
      </div>
      <div>
        <SubmitButton label="Save service" pendingLabel="Saving…" />
      </div>
    </form>
  );
}
