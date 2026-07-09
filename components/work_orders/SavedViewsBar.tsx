"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  deleteDashboardViewAction,
  saveDashboardViewAction,
  type ViewFormState,
} from "@/app/(app)/dashboard/view-actions";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  buildDashboardHref,
  type DashboardViewParams,
  type SavedDashboardView,
} from "@/lib/services/dashboardViewShared";

const initialState: ViewFormState = { error: null };

export function SavedViewsBar({
  views,
  currentParams,
}: {
  views: SavedDashboardView[];
  currentParams: DashboardViewParams;
}) {
  const [saveState, saveAction] = useActionState(
    saveDashboardViewAction,
    initialState
  );
  const [copyLabel, setCopyLabel] = useState("Copy link");
  const [name, setName] = useState("");
  const [showSave, setShowSave] = useState(false);

  async function copyLink() {
    const href = buildDashboardHref(currentParams);
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}${href}`
        : href;
    try {
      await navigator.clipboard.writeText(url);
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy link"), 2000);
    } catch {
      setCopyLabel("Copy failed");
      window.setTimeout(() => setCopyLabel("Copy link"), 2000);
    }
  }

  return (
    <div className="saved-views-bar" aria-label="Workflow views">
      <div className="saved-views-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void copyLink()}
        >
          {copyLabel}
        </button>
        <button
          type="button"
          className={
            showSave
              ? "btn btn-secondary board-control-link-active"
              : "btn btn-secondary"
          }
          onClick={() => setShowSave((open) => !open)}
          aria-expanded={showSave}
        >
          Save view
        </button>
      </div>

      {showSave ? (
        <form action={saveAction} className="saved-views-save-form">
          {Object.entries(currentParams).map(([key, value]) =>
            value ? (
              <input key={key} type="hidden" name={key} value={value} />
            ) : null
          )}
          <label className="block grow">
            <span className="field-label">View name</span>
            <input
              className="input"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. My waiting parts"
              maxLength={60}
              required
            />
          </label>
          <SubmitButton label="Save" pendingLabel="Saving…" />
          {saveState.error ? (
            <p className="form-error" role="alert">
              {saveState.error}
            </p>
          ) : null}
        </form>
      ) : null}

      {views.length > 0 ? (
        <div className="saved-views-list" role="list">
          {views.map((view) => (
            <div key={view.id} className="saved-view-chip" role="listitem">
              <Link
                href={buildDashboardHref(view.params)}
                className="saved-view-link"
              >
                {view.name}
              </Link>
              <form
                action={async () => {
                  await deleteDashboardViewAction(view.id);
                }}
              >
                <button
                  type="submit"
                  className="saved-view-delete"
                  aria-label={`Delete view ${view.name}`}
                >
                  ×
                </button>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p className="saved-views-hint">
          Save the current filters as a named view, or copy a shareable link.
        </p>
      )}
    </div>
  );
}
