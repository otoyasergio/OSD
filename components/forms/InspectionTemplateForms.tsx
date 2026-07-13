"use client";

import { useActionState } from "react";
import type { TemplateFormState } from "@/app/(app)/settings/inspection_template/actions";
import type { InspectionTemplateItem } from "@/lib/services/inspectionTemplate";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type TemplateAction = (
  state: TemplateFormState,
  formData: FormData
) => Promise<TemplateFormState>;

const CHECKBOX_CLASS = "h-4 w-4 rounded border-[var(--border-strong)] text-foreground";

export function InspectionTemplateCreateForm({
  action,
  nextDisplayOrder,
}: {
  action: TemplateAction;
  nextDisplayOrder: number;
}) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded border border-[var(--border)] bg-white p-4"
    >
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField label="Category" name="category" required />
        <TextField label="Item name" name="item_name" required />
        <TextField
          label="Display order"
          name="display_order"
          type="number"
          required
          defaultValue={nextDisplayOrder}
        />
        <label className="flex items-end gap-2 pb-2">
          <input
            className={CHECKBOX_CLASS}
            type="checkbox"
            name="requires_measurement"
            value="true"
          />
          <span className="text-sm font-medium text-foreground">
            Requires measurement
          </span>
        </label>
      </div>
      <div>
        <SubmitButton label="Add template item" pendingLabel="Adding…" />
      </div>
    </form>
  );
}

export function InspectionTemplateEditForm({
  action,
  item,
}: {
  action: TemplateAction;
  item: InspectionTemplateItem;
}) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-3 pt-3">
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Category"
          name="category"
          required
          defaultValue={item.category}
        />
        <TextField
          label="Item name"
          name="item_name"
          required
          defaultValue={item.item_name}
        />
        <TextField
          label="Display order"
          name="display_order"
          type="number"
          required
          defaultValue={item.display_order}
        />
        <label className="flex items-end gap-2 pb-2">
          <input
            className={CHECKBOX_CLASS}
            type="checkbox"
            name="requires_measurement"
            value="true"
            defaultChecked={item.requires_measurement}
          />
          <span className="text-sm font-medium text-foreground">
            Requires measurement
          </span>
        </label>
      </div>
      <div>
        <SubmitButton label="Save item" pendingLabel="Saving…" />
      </div>
    </form>
  );
}
