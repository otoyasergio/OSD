"use client";

import Link from "next/link";
import { useTransition } from "react";
import { setDashboardViewModeAction } from "@/app/(app)/dashboard/view-actions";
import {
  buildDashboardHref,
  type DashboardViewParams,
} from "@/lib/services/dashboardViewShared";

type DashboardViewMode = "board" | "list" | "cards";

const MODES: Array<{ id: DashboardViewMode; label: string }> = [
  { id: "board", label: "Columns" },
  { id: "list", label: "List" },
  { id: "cards", label: "Cards" },
];

export function DashboardViewToggle({
  view,
  filterBase,
}: {
  view: DashboardViewMode;
  filterBase: DashboardViewParams;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="view-toggle" role="group" aria-label="View mode">
      {MODES.map((mode) => {
        const href = buildDashboardHref({ ...filterBase, view: mode.id });
        const active = view === mode.id;
        return (
          <Link
            key={mode.id}
            href={href}
            className={
              active
                ? "view-toggle-link view-toggle-link-active"
                : "view-toggle-link"
            }
            aria-current={active ? "true" : undefined}
            aria-disabled={isPending || undefined}
            onClick={() => {
              startTransition(async () => {
                await setDashboardViewModeAction(mode.id);
              });
            }}
          >
            {mode.label}
          </Link>
        );
      })}
    </div>
  );
}
