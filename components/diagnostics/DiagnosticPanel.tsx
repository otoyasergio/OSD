"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  recordDiagnosticSessionAction,
  removeDiagnosticSessionAction,
  type DiagnosticActionState,
} from "@/app/(app)/motorcycles/diagnostic-actions";
import type { DiagnosticPanelData } from "@/lib/diagnostics/sessionView";
import { freezeFrameEntries } from "@/lib/diagnostics/sessionView";
import { formatDateTime } from "@/lib/datetime/format";

const INITIAL: DiagnosticActionState = { error: null };
const SLOT_COUNT = 8;

const SCAN_LABELS = {
  complete: "Full scan",
  partial: "Partial scan",
  unavailable: "Results not available",
} as const;

const SOURCE_LABELS = {
  scan_tool: "Scan tool",
  manual: "Written down",
} as const;

const STATUS_LABELS = {
  active: "Active",
  pending: "Pending",
  stored: "Stored",
} as const;

function FieldLabel({ children }: { children: string }) {
  return <span className="field-label">{children}</span>;
}

export function DiagnosticPanel({
  data,
  canRecord,
  workOrderId = null,
  customerId = null,
  newWorkOrderHref = null,
  openWorkOrderHref = null,
}: {
  data: DiagnosticPanelData;
  canRecord: boolean;
  workOrderId?: string | null;
  customerId?: string | null;
  newWorkOrderHref?: string | null;
  openWorkOrderHref?: string | null;
}) {
  const [state, action, pending] = useActionState(recordDiagnosticSessionAction, INITIAL);
  const [slots, setSlots] = useState(1);
  const visitSessions = workOrderId
    ? data.sessions.filter((session) => session.work_order_id === workOrderId)
    : data.sessions;

  return (
    <section className="flex flex-col gap-4" aria-label="Diagnostic sessions">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Diagnostics</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Fault codes from a scan tool or a written note. Nothing here is read from the
          bike remotely.
        </p>
      </div>

      <div className="card card-body" aria-label="Diagnostic health">
        <p className="font-medium text-foreground">{data.health.faultText}</p>
        <p className="text-sm text-[var(--status-neutral)]">{data.health.lastScanText}</p>
        <p className="mt-2 text-sm text-foreground">{data.health.recommendedAction}</p>
        {data.openFaultCount !== null && data.openFaultCount > 0 && newWorkOrderHref ? (
          <p className="mt-3">
            <Link href={newWorkOrderHref} className="btn btn-primary">
              Open a work order
            </Link>
          </p>
        ) : null}
        {data.openFaultCount !== null && data.openFaultCount > 0 && openWorkOrderHref ? (
          <p className="mt-3">
            <Link href={openWorkOrderHref} className="btn btn-secondary">
              Open work order
            </Link>
          </p>
        ) : null}
      </div>

      {workOrderId ? (
        <SessionList
          title="This visit"
          sessions={visitSessions}
          empty="No scan recorded on this visit yet."
          canRecord={canRecord}
          motorcycleId={data.motorcycleId}
          workOrderId={workOrderId}
          customerId={customerId}
          highlightWorkOrderId={workOrderId}
        />
      ) : null}

      <SessionList
        title={workOrderId ? "This bike" : "Recorded scans"}
        sessions={data.sessions}
        empty={
          data.loadFailed ? "Scan history could not be loaded." : "No scan on record."
        }
        canRecord={canRecord}
        motorcycleId={data.motorcycleId}
        workOrderId={workOrderId}
        customerId={customerId}
        highlightWorkOrderId={workOrderId}
      />

      {canRecord ? (
        <form action={action} className="card card-body flex flex-col gap-4">
          <h3 className="font-medium text-foreground">Record a scan</h3>
          <input type="hidden" name="motorcycle_id" value={data.motorcycleId} />
          {workOrderId ? (
            <input type="hidden" name="work_order_id" value={workOrderId} />
          ) : null}
          {customerId ? (
            <input type="hidden" name="customer_id" value={customerId} />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <FieldLabel>How it was read</FieldLabel>
              <select name="source" className="input" defaultValue="scan_tool">
                <option value="scan_tool">Scan tool</option>
                <option value="manual">Written down</option>
              </select>
            </label>
            <label>
              <FieldLabel>Scan result</FieldLabel>
              <select name="scan_results" className="input" defaultValue="complete">
                <option value="complete">Full scan</option>
                <option value="partial">Partial — some modules did not answer</option>
                <option value="unavailable">
                  Finished, but results are not available
                </option>
              </select>
            </label>
          </div>

          {Array.from({ length: slots }, (_, slot) => (
            <fieldset
              key={slot}
              className="grid gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2"
            >
              <legend className="text-sm font-medium text-foreground">
                Code {slot + 1}
              </legend>
              <label>
                <FieldLabel>Fault code</FieldLabel>
                <input
                  name={`code_${slot}`}
                  className="input"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={16}
                  placeholder="P0217"
                />
              </label>
              <label>
                <FieldLabel>Status</FieldLabel>
                <select name={`status_${slot}`} className="input" defaultValue="active">
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="stored">Stored</option>
                </select>
              </label>
              <label>
                <FieldLabel>ECU</FieldLabel>
                <input
                  name={`ecu_${slot}`}
                  className="input"
                  maxLength={40}
                  placeholder="Optional"
                />
              </label>
              <label>
                <FieldLabel>Catalog severity</FieldLabel>
                <select name={`severity_${slot}`} className="input" defaultValue="">
                  <option value="">Not in the catalog</option>
                  <option value="P0">P0 — stop riding</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
              </label>
              <label className="sm:col-span-2">
                <FieldLabel>Catalog description</FieldLabel>
                <input
                  name={`description_${slot}`}
                  className="input"
                  maxLength={400}
                  placeholder="Leave blank unless you are saving this code for the shop"
                />
              </label>
              <label>
                <FieldLabel>Odometer</FieldLabel>
                <input
                  name={`odometer_${slot}`}
                  className="input"
                  inputMode="decimal"
                  placeholder="Blank if not shown"
                />
              </label>
              <label>
                <FieldLabel>RPM</FieldLabel>
                <input
                  name={`rpm_${slot}`}
                  className="input"
                  inputMode="decimal"
                  placeholder="Blank if not shown"
                />
              </label>
              <label>
                <FieldLabel>Coolant °C</FieldLabel>
                <input
                  name={`coolant_c_${slot}`}
                  className="input"
                  inputMode="decimal"
                  placeholder="Blank if not shown"
                />
              </label>
              <label>
                <FieldLabel>Voltage</FieldLabel>
                <input
                  name={`voltage_${slot}`}
                  className="input"
                  inputMode="decimal"
                  placeholder="Blank if not shown"
                />
              </label>
            </fieldset>
          ))}

          {slots < SLOT_COUNT ? (
            <button
              type="button"
              className="btn btn-secondary self-start"
              onClick={() => setSlots((count) => Math.min(SLOT_COUNT, count + 1))}
            >
              Add another code
            </button>
          ) : null}

          <label>
            <FieldLabel>Notes</FieldLabel>
            <textarea name="notes" className="input min-h-20" maxLength={2000} />
          </label>

          {state.error ? (
            <p role="alert" className="text-sm text-red-700">
              {state.error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary self-start" disabled={pending}>
            {pending ? "Saving…" : "Save scan"}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function SessionList({
  title,
  sessions,
  empty,
  canRecord,
  motorcycleId,
  workOrderId,
  customerId,
  highlightWorkOrderId,
}: {
  title: string;
  sessions: DiagnosticPanelData["sessions"];
  empty: string;
  canRecord: boolean;
  motorcycleId: string;
  workOrderId: string | null;
  customerId: string | null;
  highlightWorkOrderId: string | null;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {sessions.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--status-neutral)]">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.session_id} className="card card-body">
              <p className="text-sm text-foreground">
                {formatDateTime(session.recorded_at)} · {SOURCE_LABELS[session.source]} ·{" "}
                {SCAN_LABELS[session.scan_results]}
                {highlightWorkOrderId && session.work_order_id === highlightWorkOrderId
                  ? " · This visit"
                  : ""}
              </p>
              {session.notes ? (
                <p className="mt-1 text-sm text-[var(--status-neutral)]">
                  {session.notes}
                </p>
              ) : null}
              {session.readings.length === 0 ? (
                <p className="mt-2 text-sm text-foreground">
                  No fault codes on this scan.
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {session.readings.map((reading) => {
                    const frame = freezeFrameEntries(reading.freeze_frame);
                    return (
                      <li key={reading.reading_id} className="text-sm text-foreground">
                        <span className="font-medium">{reading.code}</span>
                        {" · "}
                        {STATUS_LABELS[reading.status]}
                        {reading.ecu ? ` · ${reading.ecu}` : ""}
                        {frame.length > 0 ? (
                          <span className="mt-1 block text-[var(--status-neutral)]">
                            {frame
                              .map((entry) => `${entry.label} ${entry.value}`)
                              .join(" · ")}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canRecord ? (
                <RemoveScanForm
                  sessionId={session.session_id}
                  motorcycleId={motorcycleId}
                  workOrderId={workOrderId}
                  customerId={customerId}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RemoveScanForm({
  sessionId,
  motorcycleId,
  workOrderId,
  customerId,
}: {
  sessionId: string;
  motorcycleId: string;
  workOrderId: string | null;
  customerId: string | null;
}) {
  const [state, action, pending] = useActionState(removeDiagnosticSessionAction, INITIAL);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="motorcycle_id" value={motorcycleId} />
      {workOrderId ? (
        <input type="hidden" name="work_order_id" value={workOrderId} />
      ) : null}
      {customerId ? <input type="hidden" name="customer_id" value={customerId} /> : null}
      <button type="submit" className="btn btn-secondary" disabled={pending}>
        {pending ? "Removing…" : "Remove this scan"}
      </button>
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
