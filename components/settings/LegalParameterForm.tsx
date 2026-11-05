"use client";

import { useActionState } from "react";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  addLegalParameterAction,
  type LegalFormState,
} from "@/app/(app)/settings/legal/actions";

const blank: LegalFormState = { error: null, saved: false };

export function LegalParameterForm() {
  const [state, action] = useActionState(addLegalParameterAction, blank);
  return (
    <form action={action} className="card card-pad grid gap-3">
      <h2 className="font-semibold text-foreground">Add a rule row</h2>
      <p className="text-sm text-[var(--status-neutral)]">
        Earlier rows stay. Estimates presented after the effective date use this row,
        including the statutory warranty exemptions for fluids, filters, lights, tires,
        and batteries.
      </p>
      <FormError message={state.error} />
      {state.saved ? <p className="text-sm text-foreground">Rule row saved.</p> : null}
      <TextField label="Effective date" name="effective_on" type="date" required />
      <TextField
        label="Citation"
        name="source_citation"
        required
        placeholder="Consumer Protection Act, 2002"
      />
      <TextField
        label="Ceiling (basis points)"
        name="ceiling_bps"
        type="number"
        min="0"
        max="10000"
        step="1"
        required
        defaultValue="1000"
        hint="1000 is 10 percent."
      />
      <TextAreaField label="Estimate fee rule" name="estimate_fee_rule" required />
      <TextAreaField label="Warranty summary" name="warranty_summary" required />
      <TextAreaField label="Warranty exemptions" name="warranty_exemptions" required />
      <SubmitButton label="Add rule row" pendingLabel="Saving…" />
    </form>
  );
}
