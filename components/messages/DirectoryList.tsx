"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DirectoryStaff } from "@/lib/services/directory";
import { startDirectMessageAction } from "@/app/(app)/messages/actions";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  service_advisor: "Service Advisor",
  technician: "Technician",
  admin: "Admin",
};

type Props = {
  atLocation: DirectoryStaff[];
  allCompany: DirectoryStaff[];
  multiSelect?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (userId: string) => void;
};

export function DirectoryList({
  atLocation,
  allCompany,
  multiSelect = false,
  selectedIds = [],
  onToggleSelect,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  function openDm(userId: string) {
    if (multiSelect && onToggleSelect) {
      onToggleSelect(userId);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await startDirectMessageAction(userId);
      if (result.error || !result.conversationId) {
        setError(result.error ?? "Could not start conversation.");
        return;
      }
      router.push(`/messages/${result.conversationId}`);
    });
  }

  function renderSection(title: string, people: DirectoryStaff[]) {
    if (people.length === 0) return null;
    return (
      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h2>
        <ul className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {people.map((person) => {
            const checked = selected.has(person.user_id);
            return (
              <li
                key={person.user_id}
                className="border-b border-[var(--border)] last:border-b-0"
              >
                <button
                  type="button"
                  disabled={pending && !multiSelect}
                  onClick={() => openDm(person.user_id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-muted)] disabled:opacity-60"
                >
                  {multiSelect ? (
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded border ${
                        checked
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--border-strong)]"
                      }`}
                    >
                      {checked ? "✓" : ""}
                    </span>
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-muted)] text-sm font-semibold">
                      {person.first_name.slice(0, 1)}
                      {person.last_name.slice(0, 1)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {person.first_name} {person.last_name}
                    </span>
                    <span className="block text-sm text-slate-500">
                      {ROLE_LABELS[person.role] ?? person.role}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <div>
      {error ? (
        <p className="mb-3 rounded-lg bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger-fg)]">
          {error}
        </p>
      ) : null}
      {renderSection("At this location", atLocation)}
      {renderSection("All company", allCompany)}
      {atLocation.length === 0 && allCompany.length === 0 ? (
        <p className="text-sm text-slate-500">No staff found.</p>
      ) : null}
    </div>
  );
}
