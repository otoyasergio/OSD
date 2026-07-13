"use client";

import { useActionState, useState } from "react";
import type { Part } from "@/lib/services/parts";
import type { WorkOrderJob } from "@/lib/services/workOrders";
import type { PartFormState } from "@/app/(app)/work_orders/part-actions";
import type { JobStatus, PartStatus } from "@/lib/database/types";
import { JOB_STATUS_LABELS, PART_STATUS_LABELS } from "@/lib/status/labels";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  PartsCanadaFinder,
  type PartsCanadaSelection,
} from "@/components/parts/PartsCanadaFinder";

type Action = (state: PartFormState, formData: FormData) => Promise<PartFormState>;

// Server action curried with work_order_id; partId is bound client-side so no
// function factory has to cross the RSC boundary.
type PartAction = (
  partId: string,
  state: PartFormState,
  formData: FormData
) => Promise<PartFormState>;

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const ORDERABLE_JOB_STATUSES: JobStatus[] = [
  "approved",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
];

const STATUS_TRANSITIONS: PartStatus[] = [
  "needed",
  "in_stock",
  "ordered",
  "installed",
  "not_required",
  "cancelled",
];

function canOrderForJob(status: JobStatus | undefined): boolean {
  if (!status) return false;
  return ORDERABLE_JOB_STATUSES.includes(status);
}

function moneyLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `$${Number(value).toFixed(2)}`;
}

export function PartsTab({
  parts,
  jobs,
  readOnly,
  canManage,
  canInstall,
  canViewCost,
  addAction,
  statusActionFor,
  priceActionFor,
}: {
  parts: Part[];
  jobs: WorkOrderJob[];
  readOnly: boolean;
  canManage: boolean;
  canInstall: boolean;
  canViewCost: boolean;
  addAction: Action;
  statusActionFor: PartAction;
  priceActionFor: PartAction;
}) {
  const [addState, addFormAction] = useActionState(addAction, { error: null });
  const [catalog, setCatalog] = useState({
    part_name: "",
    part_number: "",
    supplier: "",
    unit_price: "",
    unit_cost: "",
    supplier_stock: "",
    catalog_source: "manual" as "manual" | "parts_canada",
  });

  const activeJobs = jobs.filter(
    (job) => job.status !== "cancelled" && job.status !== "declined"
  );

  function applyCatalogSelection(selection: PartsCanadaSelection) {
    setCatalog({
      part_name: selection.part_name,
      part_number: selection.part_number,
      supplier: selection.supplier,
      unit_price: selection.unit_price,
      unit_cost: selection.unit_cost,
      supplier_stock: selection.supplier_stock,
      catalog_source: selection.catalog_source,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {!readOnly && canManage ? (
        <form
          action={addFormAction}
          className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4"
        >
          <h3 className="text-base font-semibold text-foreground">Add part</h3>
          <FormError message={addState.error} />

          <PartsCanadaFinder canViewCost={canViewCost} onSelect={applyCatalogSelection} />

          <input type="hidden" name="catalog_source" value={catalog.catalog_source} />
          <input type="hidden" name="unit_cost" value={catalog.unit_cost} />
          <input type="hidden" name="supplier_stock" value={catalog.supplier_stock} />

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Job <span className="text-red-600">*</span>
            </span>
            <select className={SELECT_CLASS} name="job_id" required defaultValue="">
              <option value="">Select job</option>
              {activeJobs.map((job) => (
                <option key={job.job_id} value={job.job_id}>
                  {job.service_name_snapshot} (
                  {JOB_STATUS_LABELS[job.status] ?? job.status})
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Part name"
              name="part_name"
              required
              key={`name-${catalog.part_number}-${catalog.part_name}`}
              defaultValue={catalog.part_name}
            />
            <TextField
              label="Part number"
              name="part_number"
              key={`number-${catalog.part_number}`}
              defaultValue={catalog.part_number}
            />
            <TextField
              label="Supplier"
              name="supplier"
              key={`supplier-${catalog.supplier}-${catalog.part_number}`}
              defaultValue={catalog.supplier}
            />
            <TextField label="Quantity" name="quantity" type="number" defaultValue={1} />
            <TextField
              label="Sell price (MSRP)"
              name="unit_price"
              type="number"
              key={`price-${catalog.part_number}-${catalog.unit_price}`}
              defaultValue={catalog.unit_price}
            />
            {canViewCost && catalog.unit_cost ? (
              <p className="self-end text-sm text-[var(--status-neutral)]">
                Dealer cost: {moneyLabel(Number(catalog.unit_cost))}
                {catalog.supplier_stock ? ` · PC stock: ${catalog.supplier_stock}` : ""}
              </p>
            ) : catalog.supplier_stock ? (
              <p className="self-end text-sm text-[var(--status-neutral)]">
                PC stock: {catalog.supplier_stock}
              </p>
            ) : null}
          </div>
          <TextField label="Notes" name="notes" />
          <div>
            <SubmitButton label="Add part" pendingLabel="Adding…" />
          </div>
          <p className="text-xs text-[var(--status-neutral)]">
            Parts can be listed before approval. Ordering is blocked until the job is
            approved. Sell price is editable for this line only.
          </p>
        </form>
      ) : null}

      {parts.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-10 text-center text-[var(--status-neutral)]">
          No parts on this work order yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {parts.map((part) => (
            <PartCard
              key={part.part_id}
              part={part}
              readOnly={readOnly}
              canManage={canManage}
              canInstall={canInstall}
              canViewCost={canViewCost}
              statusAction={statusActionFor.bind(null, part.part_id)}
              priceAction={priceActionFor.bind(null, part.part_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PartCard({
  part,
  readOnly,
  canManage,
  canInstall,
  canViewCost,
  statusAction,
  priceAction,
}: {
  part: Part;
  readOnly: boolean;
  canManage: boolean;
  canInstall: boolean;
  canViewCost: boolean;
  statusAction: Action;
  priceAction: Action;
}) {
  const [state, formAction] = useActionState(statusAction, { error: null });
  const [priceState, priceFormAction] = useActionState(priceAction, {
    error: null,
  });
  const jobStatus = part.job?.status;
  const orderAllowed = canOrderForJob(jobStatus);

  return (
    <article className="rounded border border-[var(--border)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{part.part_name}</h3>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            {PART_STATUS_LABELS[part.status]} · qty {part.quantity}
            {part.job
              ? ` · ${part.job.service_name_snapshot} (${JOB_STATUS_LABELS[part.job.status]})`
              : ""}
          </p>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            {[part.part_number, part.supplier].filter(Boolean).join(" · ") ||
              "No part # / supplier"}
          </p>
          <p className="mt-1 text-sm text-foreground">
            Sell {moneyLabel(part.unit_price)}
            {canViewCost ? ` · Cost ${moneyLabel(part.unit_cost)}` : ""}
            {part.supplier_stock != null ? ` · PC stock ${part.supplier_stock}` : ""}
          </p>
          {part.notes ? (
            <p className="mt-2 text-sm text-foreground">{part.notes}</p>
          ) : null}
        </div>
      </div>

      {!readOnly && canManage ? (
        <form action={priceFormAction} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">
              Edit sell price
            </span>
            <input
              type="number"
              name="unit_price"
              step="0.01"
              min="0"
              defaultValue={part.unit_price ?? ""}
              className="min-h-11 w-36 rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]"
            />
          </label>
          <SubmitButton label="Update price" pendingLabel="Saving…" />
          <FormError message={priceState.error} />
        </form>
      ) : null}

      {!readOnly && (canManage || canInstall) ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {STATUS_TRANSITIONS.filter((status) => status !== part.status).map(
              (status) => {
                if (status === "ordered" && !canManage) return null;
                if (status === "ordered" && !orderAllowed) return null;
                if (status === "installed" && !canInstall && !canManage) {
                  return null;
                }
                if (status !== "ordered" && status !== "installed" && !canManage) {
                  return null;
                }

                return (
                  <form key={status} action={formAction} className="inline">
                    <input type="hidden" name="status" value={status} />
                    <button
                      type="submit"
                      className="min-h-11 rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-sm font-semibold text-foreground hover:bg-[var(--surface-muted)]"
                    >
                      Mark {PART_STATUS_LABELS[status].toLowerCase()}
                    </button>
                  </form>
                );
              }
            )}
          </div>
          {part.status !== "ordered" && canManage && !orderAllowed ? (
            <p className="text-sm text-amber-800">
              Ordering is blocked until this job is approved by the customer.
            </p>
          ) : null}
          <FormError message={state.error} />
        </div>
      ) : null}
    </article>
  );
}
