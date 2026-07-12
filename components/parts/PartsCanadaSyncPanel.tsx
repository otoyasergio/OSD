"use client";

import { useActionState } from "react";
import {
  syncPartsCanadaAction,
  type PartsCanadaSyncFormState,
} from "@/app/(app)/parts/actions";
import type { PartsCanadaSyncStatus } from "@/lib/services/partsCanadaCatalog";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function PartsCanadaSyncPanel({
  status,
  canSync,
}: {
  status: PartsCanadaSyncStatus;
  canSync: boolean;
}) {
  const [state, action] = useActionState(syncPartsCanadaAction, {
    error: null,
    success: null,
  } satisfies PartsCanadaSyncFormState);

  const last = status.last_run;

  return (
    <section className="rounded border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">
            Parts Canada catalog
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            {status.configured
              ? `${status.catalog_count.toLocaleString()} items cached locally.`
              : "API key not configured on the server yet."}
          </p>
          {last ? (
            <p className="mt-1 text-sm text-zinc-500">
              Last sync: {last.status}
              {last.row_count != null
                ? ` · ${last.row_count.toLocaleString()} rows`
                : ""}{" "}
              · {formatWhen(last.finished_at ?? last.started_at)}
              {last.error_message ? ` · ${last.error_message}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">No sync has run yet.</p>
          )}
        </div>
        {canSync ? (
          <form action={action}>
            <SubmitButton
              label="Sync catalog now"
              pendingLabel="Syncing…"
              disabled={!status.configured}
            />
          </form>
        ) : null}
      </div>
      <FormError message={state.error} />
      {state.success ? (
        <p className="mt-2 text-sm text-emerald-700" role="status">
          {state.success}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-zinc-500">
        Inventory is downloaded once per day (Parts Canada rate limit). Pricing
        and stock in search results come from this local catalog.
      </p>
    </section>
  );
}
