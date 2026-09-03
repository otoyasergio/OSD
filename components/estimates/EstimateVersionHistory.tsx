"use client";

import { StageChip } from "@/components/ui/StageChip";
import { estimateStatusChip, formatCents } from "@/components/estimates/workspaceModel";

export type EstimateVersionHistoryEntry = {
  estimate_version_id: string;
  version_no: number;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  presented_at: string | null;
  finalized_at: string | null;
  created_at: string;
};

function formatWhen(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function EstimateVersionHistory({
  versions,
}: {
  versions: EstimateVersionHistoryEntry[];
}) {
  if (versions.length === 0) return null;

  return (
    <section aria-label="Estimate version history" className="card card-body">
      <h3 className="text-base font-semibold text-[var(--foreground)]">
        Version history
      </h3>
      <ul className="mt-3 flex flex-col divide-y divide-[var(--border)]">
        {versions.map((version) => {
          const chip = estimateStatusChip(version.status);
          return (
            <li
              key={version.estimate_version_id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  Version {version.version_no}
                </span>
                <StageChip label={chip.label} tone={chip.tone} />
              </div>
              <div className="flex items-center gap-3 text-sm text-[var(--status-neutral)]">
                <span>
                  {version.presented_at
                    ? `Presented ${formatWhen(version.presented_at)}`
                    : `Created ${formatWhen(version.created_at)}`}
                </span>
                <span className="font-semibold text-[var(--foreground)]">
                  {formatCents(version.total_cents)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
