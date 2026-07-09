"use client";

import { useActionState } from "react";
import type { ServiceFormState } from "@/app/(app)/settings/services/actions";
import type { Service } from "@/lib/services/serviceCatalogue";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type ServiceAction = (
  state: ServiceFormState,
  formData: FormData
) => Promise<ServiceFormState>;

export function ServiceCreateForm({ action }: { action: ServiceAction }) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded border border-zinc-200 bg-white p-4"
    >
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Service name" name="name" required />
        <TextField label="Standard price" name="standard_price" type="number" />
        <TextField
          label="Estimated labour (hours)"
          name="estimated_labour"
          type="number"
        />
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
}: {
  action: ServiceAction;
  service: Service;
}) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-3 pt-3">
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Service name" name="name" required defaultValue={service.name} />
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
      <div>
        <SubmitButton label="Save service" pendingLabel="Saving…" />
      </div>
    </form>
  );
}
