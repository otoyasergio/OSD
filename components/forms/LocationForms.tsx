"use client";

import { useActionState } from "react";
import type { LocationFormState } from "@/app/(app)/settings/locations/actions";
import type { LocationRecord, LocationUserOption } from "@/lib/services/locations";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

type Action = (
  state: LocationFormState,
  formData: FormData
) => Promise<LocationFormState>;

export function LocationCreateForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4"
    >
      <h2 className="font-semibold text-foreground">Create location</h2>
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" name="name" required />
        <TextField
          label="Code"
          name="code"
          required
          placeholder="e.g. TOR"
          hint="Short unique code used in ops references."
        />
      </div>
      <div>
        <SubmitButton label="Create location" pendingLabel="Creating…" />
      </div>
    </form>
  );
}

export function LocationEditForm({
  location,
  users,
  updateAction,
  assignAction,
}: {
  location: LocationRecord;
  users: LocationUserOption[];
  updateAction: Action;
  assignAction: Action;
}) {
  const [updateState, updateFormAction] = useActionState(updateAction, {
    error: null,
  });
  const [assignState, assignFormAction] = useActionState(assignAction, {
    error: null,
  });
  const assigned = new Set(location.assigned_user_ids);

  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-2">
      <form action={updateFormAction} className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Details</h3>
        <FormError message={updateState.error} />
        <TextField label="Name" name="name" required defaultValue={location.name} />
        <TextField label="Code" name="code" required defaultValue={location.code} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">Status</span>
          <select className={SELECT_CLASS} name="status" defaultValue={location.status}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <div>
          <SubmitButton label="Save location" pendingLabel="Saving…" />
        </div>
      </form>

      <form action={assignFormAction} className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          Assigned staff ({location.user_count})
        </h3>
        <FormError message={assignState.error} />
        <div className="max-h-64 space-y-2 overflow-y-auto rounded border border-[var(--border)] p-3">
          {users.length === 0 ? (
            <p className="text-sm text-[var(--status-neutral)]">No users yet.</p>
          ) : (
            users.map((person) => (
              <label
                key={person.user_id}
                className="flex min-h-11 items-center gap-2 text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  name="user_ids"
                  value={person.user_id}
                  defaultChecked={assigned.has(person.user_id)}
                  className="size-4"
                />
                <span>
                  {person.first_name} {person.last_name}{" "}
                  <span className="text-[var(--status-neutral)]">
                    ({person.role}
                    {person.status !== "active" ? ` · ${person.status}` : ""})
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
        <div>
          <SubmitButton label="Save assignments" pendingLabel="Saving…" />
        </div>
      </form>
    </div>
  );
}
