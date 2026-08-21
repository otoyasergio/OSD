"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRolePreview } from "@/app/(app)/actions/set-role-preview";
import type { RolePreviewRole } from "@/lib/auth/role-preview-shared";

export type RolePreviewTechnicianOption = {
  user_id: string;
  first_name: string;
  last_name: string;
};

export type RolePreviewState = {
  /** Selected preview role ("owner" when not previewing). */
  role: RolePreviewRole;
  isPreviewing: boolean;
  /** Mirrored technician's display name (technician preview only). */
  subjectLabel: string | null;
  /** Mirrored technician's id (technician preview only). */
  subjectUserId: string | null;
  technicians: RolePreviewTechnicianOption[];
};

const ROLE_OPTIONS: Array<{ value: RolePreviewRole; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "service_advisor", label: "Service Advisor" },
  { value: "admin", label: "Admin" },
  { value: "technician", label: "Tech" },
];

export function rolePreviewLabel(role: RolePreviewRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function useApplyRolePreview() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply(role: RolePreviewRole, technicianId?: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        const { home } = await setRolePreview({ role, technicianId });
        router.push(home);
        router.refresh();
      } catch {
        setError("Could not switch view. Try again.");
      }
    });
  }

  return { apply, pending, error };
}

type SwitcherProps = {
  preview: RolePreviewState;
};

/** Owner-only "View as" control — rendered in the sidebar on all breakpoints. */
export function RolePreviewSwitcher({ preview }: SwitcherProps) {
  const { apply, pending, error } = useApplyRolePreview();
  const [needsTechnician, setNeedsTechnician] = useState(false);

  const hasTechnicians = preview.technicians.length > 0;
  const selectedTechnicianId =
    preview.subjectUserId ?? preview.technicians[0]?.user_id ?? "";

  function onRoleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const role = event.target.value as RolePreviewRole;
    if (role === preview.role) return;
    if (role === "technician") {
      if (!hasTechnicians) {
        setNeedsTechnician(true);
        event.target.value = preview.role;
        return;
      }
      setNeedsTechnician(false);
      apply(role, selectedTechnicianId);
      return;
    }
    setNeedsTechnician(false);
    apply(role);
  }

  function onTechnicianChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const technicianId = event.target.value;
    if (!technicianId || technicianId === preview.subjectUserId) return;
    apply("technician", technicianId);
  }

  return (
    <div className="role-preview-switcher" data-previewing={preview.isPreviewing}>
      <label className="flex flex-col gap-1 text-xs text-chrome-muted">
        <span className="font-medium uppercase tracking-wide">View as</span>
        <select
          value={preview.role}
          onChange={onRoleChange}
          disabled={pending}
          className="select-dark w-full disabled:opacity-60"
          aria-label="View the app as another role"
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {preview.role === "technician" && hasTechnicians ? (
        <label className="mt-2 flex flex-col gap-1 text-xs text-chrome-muted">
          <span className="font-medium uppercase tracking-wide">Technician</span>
          <select
            value={selectedTechnicianId}
            onChange={onTechnicianChange}
            disabled={pending}
            className="select-dark w-full disabled:opacity-60"
            aria-label="Technician to view as"
          >
            {preview.technicians.map((tech) => (
              <option key={tech.user_id} value={tech.user_id}>
                {tech.first_name} {tech.last_name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {needsTechnician ? (
        <p className="mt-2 text-xs text-amber-400" role="status">
          No active technicians at this location to view as.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-red-400" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type BannerProps = {
  preview: RolePreviewState;
  ownerName: string;
};

/** Persistent reminder that the visible app is a preview, with one-tap exit. */
export function RolePreviewBanner({ preview, ownerName }: BannerProps) {
  const { apply, pending, error } = useApplyRolePreview();
  if (!preview.isPreviewing) return null;

  const roleLabel = rolePreviewLabel(preview.role);
  const viewingLabel = preview.subjectLabel
    ? `${roleLabel} — ${preview.subjectLabel}`
    : roleLabel;

  return (
    <div className="role-preview-banner" role="status">
      <p className="role-preview-banner-text">
        <span className="font-semibold">Viewing as {viewingLabel}.</span> Actions are
        logged as {ownerName} (Owner).
        {error ? <span className="ml-2 text-red-200">{error}</span> : null}
      </p>
      <button
        type="button"
        className="role-preview-banner-exit"
        disabled={pending}
        onClick={() => apply("owner")}
      >
        Exit preview
      </button>
    </div>
  );
}
