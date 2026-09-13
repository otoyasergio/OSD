"use client";

import { useActionState } from "react";
import type { UserFormState } from "@/app/(app)/settings/users/actions";
import type { LocationOption, ManagedUser } from "@/lib/services/users";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "service_advisor", label: "Service advisor" },
  { value: "technician", label: "Technician" },
  { value: "head_tech", label: "Head tech" },
  { value: "admin", label: "Admin" },
  { value: "time_clock_kiosk", label: "Time clock kiosk" },
] as const;

type Action = (state: UserFormState, formData: FormData) => Promise<UserFormState>;

function LocationCheckboxes({
  locations,
  selected,
}: {
  locations: LocationOption[];
  selected?: string[];
}) {
  const selectedSet = new Set(selected ?? []);
  if (locations.length === 0) {
    return (
      <p className="text-sm text-[var(--status-neutral)]">
        Create a location before assigning users.
      </p>
    );
  }
  return (
    <div className="max-h-48 space-y-2 overflow-y-auto rounded border border-[var(--border)] p-3">
      {locations.map((location) => (
        <label
          key={location.location_id}
          className="flex min-h-11 items-center gap-2 text-sm text-foreground"
        >
          <input
            type="checkbox"
            name="location_ids"
            value={location.location_id}
            defaultChecked={selectedSet.has(location.location_id)}
            className="size-4"
          />
          <span>
            {location.name}{" "}
            <span className="text-[var(--status-neutral)]">({location.code})</span>
            {location.status !== "active" ? (
              <span className="ml-1 text-xs text-[var(--status-neutral)]">inactive</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}

export function UserLinkForm({
  action,
  locations,
}: {
  action: Action;
  locations: LocationOption[];
}) {
  const [state, formAction] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4"
    >
      <h2 className="font-semibold text-foreground">Link Auth user</h2>
      <p className="text-sm text-[var(--status-neutral)]">
        Create the login in Supabase Auth first, then paste the Auth user UUID here to
        create the app profile, role, and locations.
      </p>
      <FormError message={state.error} />
      <TextField
        label="Auth user id"
        name="auth_user_id"
        required
        placeholder="UUID from auth.users"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="First name" name="first_name" required />
        <TextField label="Last name" name="last_name" required />
        <TextField label="Email" name="email" type="email" required />
        <TextField label="Phone" name="phone" type="tel" />
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground">Role</span>
        <select className={SELECT_CLASS} name="role" defaultValue="technician" required>
          {ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <span className="mb-1.5 block text-sm font-medium text-foreground">
          Locations
        </span>
        <LocationCheckboxes locations={locations} />
      </div>
      <div>
        <SubmitButton label="Link user" pendingLabel="Saving…" />
      </div>
    </form>
  );
}

export function UserEditForm({
  user,
  locations,
  updateAction,
  suspendAction,
  activateAction,
}: {
  user: ManagedUser;
  locations: LocationOption[];
  updateAction: Action;
  suspendAction: () => Promise<void>;
  activateAction: () => Promise<void>;
}) {
  const [state, formAction] = useActionState(updateAction, { error: null });

  return (
    <div className="mt-3 flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3">
        <FormError message={state.error} />
        <p className="text-xs text-[var(--status-neutral)]">
          Auth user id: {user.auth_user_id ?? "—"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="First name"
            name="first_name"
            required
            defaultValue={user.first_name}
          />
          <TextField
            label="Last name"
            name="last_name"
            required
            defaultValue={user.last_name}
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            required
            defaultValue={user.email}
          />
          <TextField label="Phone" name="phone" type="tel" defaultValue={user.phone} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Role</span>
            <select
              className={SELECT_CLASS}
              name="role"
              defaultValue={user.role}
              required
            >
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Status
            </span>
            <select
              className={SELECT_CLASS}
              name="status"
              defaultValue={user.status}
              required
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            Locations
          </span>
          <LocationCheckboxes locations={locations} selected={user.location_ids} />
        </div>
        <div>
          <SubmitButton label="Save user" pendingLabel="Saving…" />
        </div>
      </form>

      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
        {user.status === "active" ? (
          <form action={suspendAction}>
            <button
              type="submit"
              className="min-h-11 rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50"
            >
              Suspend (blocks login)
            </button>
          </form>
        ) : (
          <form action={activateAction}>
            <button
              type="submit"
              className="min-h-11 rounded border border-[var(--border-strong)] px-4 py-2 text-sm font-medium text-foreground hover:bg-[var(--surface-muted)]"
            >
              Reactivate
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
