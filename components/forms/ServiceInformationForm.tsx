"use client";

import { useActionState } from "react";
import type { MotorcycleFormState } from "@/app/(app)/motorcycles/actions";
import type { ServiceInformation } from "@/lib/services/motorcycles";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

const FIELDS = [
  { name: "oil_filter", label: "Oil filter" },
  { name: "oil_type", label: "Oil type" },
  { name: "oil_capacity", label: "Oil capacity" },
  { name: "air_filter", label: "Air filter" },
  { name: "spark_plugs", label: "Spark plugs" },
  { name: "front_brake_pads", label: "Front brake pads" },
  { name: "rear_brake_pads", label: "Rear brake pads" },
  { name: "front_tire_size", label: "Front tire size" },
  { name: "rear_tire_size", label: "Rear tire size" },
  { name: "chain", label: "Chain" },
  { name: "battery", label: "Battery" },
] as const;

type Props = {
  action: (
    state: MotorcycleFormState,
    formData: FormData
  ) => Promise<MotorcycleFormState>;
  serviceInformation: ServiceInformation | null;
  canEdit: boolean;
};

export function ServiceInformationForm({
  action,
  serviceInformation,
  canEdit,
}: Props) {
  const [state, formAction] = useActionState(action, { error: null });

  if (!canEdit) {
    return (
      <dl className="grid gap-3 rounded border border-zinc-200 bg-white p-4 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <div key={field.name}>
            <dt className="text-xs font-medium text-zinc-500">{field.label}</dt>
            <dd className="text-sm text-zinc-900">
              {serviceInformation?.[field.name] ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.error} />

      <div className="grid gap-4 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <TextField
            key={field.name}
            label={field.label}
            name={field.name}
            defaultValue={serviceInformation?.[field.name]}
          />
        ))}
      </div>

      <TextAreaField
        label="Notes"
        name="notes"
        defaultValue={serviceInformation?.notes}
      />

      <div>
        <SubmitButton label="Save service information" pendingLabel="Saving…" />
      </div>
    </form>
  );
}
