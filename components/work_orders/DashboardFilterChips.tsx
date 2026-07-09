import Link from "next/link";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import type { DashboardFilters } from "@/lib/services/dashboard";
import { DASHBOARD_CARDS } from "@/lib/services/dashboard";
import type { WorkOrderStatus } from "@/lib/database/types";

type Chip = {
  key: string;
  label: string;
  href: string;
};

function buildHref(
  base: Record<string, string | undefined>,
  omit: string
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(base)) {
    if (key === omit || !value) continue;
    search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

export function DashboardFilterChips({
  filters,
  technicians,
  view,
  hideEmpty,
  density,
}: {
  filters: DashboardFilters;
  technicians: Array<{ user_id: string; first_name: string; last_name: string }>;
  view: "board" | "list" | "cards";
  hideEmpty: boolean;
  density: "compact" | "comfortable";
}) {
  const base: Record<string, string | undefined> = {
    view,
    card: filters.card || undefined,
    status: filters.status || undefined,
    technician_id: filters.technician_id || undefined,
    flag: filters.flag || undefined,
    q: filters.q || undefined,
    hide_empty: hideEmpty ? "1" : undefined,
    density: density === "comfortable" ? "comfortable" : undefined,
  };

  const chips: Chip[] = [];

  if (filters.card) {
    const cardLabel =
      DASHBOARD_CARDS.find((card) => card.key === filters.card)?.label ??
      filters.card;
    chips.push({
      key: "card",
      label: cardLabel,
      href: buildHref(base, "card"),
    });
  }

  if (filters.status) {
    chips.push({
      key: "status",
      label:
        WORK_ORDER_STATUS_LABELS[filters.status as WorkOrderStatus] ??
        filters.status,
      href: buildHref(base, "status"),
    });
  }

  if (filters.technician_id) {
    const tech = technicians.find((t) => t.user_id === filters.technician_id);
    chips.push({
      key: "technician_id",
      label: tech
        ? `${tech.first_name} ${tech.last_name}`
        : "Technician filter",
      href: buildHref(base, "technician_id"),
    });
  }

  if (filters.flag) {
    chips.push({
      key: "flag",
      label: filters.flag,
      href: buildHref(base, "flag"),
    });
  }

  if (filters.q) {
    chips.push({
      key: "q",
      label: `Search: ${filters.q}`,
      href: buildHref(base, "q"),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="filter-chips" aria-label="Active filters">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          className="filter-chip"
          aria-label={`Remove filter: ${chip.label}`}
        >
          <span>{chip.label}</span>
          <span className="filter-chip-remove" aria-hidden>
            ×
          </span>
        </Link>
      ))}
      <Link href={`/dashboard?view=${view}`} className="filter-chip-clear">
        Clear all
      </Link>
    </div>
  );
}
