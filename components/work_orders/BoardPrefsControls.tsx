"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  setDashboardDensityAction,
  setHiddenBoardColumnsAction,
  type ViewFormState,
} from "@/app/(app)/dashboard/view-actions";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { SHOP_BOARD_COLUMNS } from "@/lib/status/pipeline";
import { buildDashboardHref, type DashboardViewParams } from "@/lib/services/dashboardViewShared";

const initialState: ViewFormState = { error: null };

export function BoardPrefsControls({
  filterBase,
  density,
  hideEmpty,
  hiddenColumnIds,
  mode,
}: {
  filterBase: DashboardViewParams;
  density: "compact" | "comfortable";
  hideEmpty: boolean;
  hiddenColumnIds: string[];
  mode: "board" | "list" | "cards";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showColumns, setShowColumns] = useState(false);
  const [columnsState, columnsAction] = useActionState(
    async (_prev: ViewFormState, formData: FormData) => {
      const result = await setHiddenBoardColumnsAction(formData);
      return result;
    },
    initialState
  );

  const hideEmptyHref = buildDashboardHref({
    ...filterBase,
    hide_empty: hideEmpty ? undefined : "1",
  });

  function setDensity(next: "compact" | "comfortable") {
    startTransition(async () => {
      await setDashboardDensityAction(next);
      router.push(
        buildDashboardHref({
          ...filterBase,
          density: next === "comfortable" ? "comfortable" : undefined,
        })
      );
      router.refresh();
    });
  }

  if (mode === "cards") {
    return null;
  }

  return (
    <div className="board-controls" role="group" aria-label={`${mode} display options`}>
      <Link
        href={hideEmptyHref}
        className={
          hideEmpty
            ? "board-control-link board-control-link-active"
            : "board-control-link"
        }
        aria-pressed={hideEmpty}
      >
        {mode === "board" ? "Hide empty columns" : "Hide empty sections"}
      </Link>

      {mode === "board" ? (
        <>
          <button
            type="button"
            className={
              density === "comfortable"
                ? "board-control-link board-control-link-active"
                : "board-control-link"
            }
            aria-pressed={density === "comfortable"}
            disabled={isPending}
            onClick={() =>
              setDensity(density === "compact" ? "comfortable" : "compact")
            }
          >
            Comfortable cards
          </button>
          <button
            type="button"
            className={
              showColumns
                ? "board-control-link board-control-link-active"
                : "board-control-link"
            }
            aria-expanded={showColumns}
            onClick={() => setShowColumns((open) => !open)}
          >
            Columns
          </button>
        </>
      ) : null}

      {mode === "board" && showColumns ? (
        <form action={columnsAction} className="board-columns-form">
          <p className="board-columns-title">Show columns</p>
          <div className="board-columns-grid">
            {SHOP_BOARD_COLUMNS.map((column) => {
              const hidden = hiddenColumnIds.includes(column.id);
              return (
                <label key={column.id} className="board-column-option">
                  <input
                    type="checkbox"
                    name="visible_columns"
                    value={column.id}
                    defaultChecked={!hidden}
                  />
                  <span>{column.label}</span>
                </label>
              );
            })}
          </div>
          <SubmitButton label="Save columns" pendingLabel="Saving…" variant="secondary" />
          {columnsState.error ? (
            <p className="form-error" role="alert">
              {columnsState.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
