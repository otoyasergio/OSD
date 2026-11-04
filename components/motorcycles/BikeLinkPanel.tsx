"use client";

import { useActionState } from "react";
import type { BikeLinkFormState } from "@/app/(app)/motorcycles/bike-link-actions";
import type { BikeLinkView } from "@/lib/services/bikeLink";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { formatDateTime } from "@/lib/datetime/format";
import { formatMileage } from "@/lib/mileage/format";

type Action = (
  state: BikeLinkFormState,
  formData: FormData
) => Promise<BikeLinkFormState>;

type Props = {
  view: BikeLinkView;
  canEdit: boolean;
  recordedAtDefault: string;
  recordAction: Action;
  scheduleAction: Action;
  boxAction: Action;
};

const SERVICE_LABEL = {
  ok: "On schedule",
  due_soon: "Coming due",
  due: "Due",
  unknown: "No history",
} as const;

const BATTERY_LABEL = {
  ok: "Healthy",
  low: "Low",
  flat: "Flat",
  unknown: "No voltage",
} as const;

export function BikeLinkPanel({
  view,
  canEdit,
  recordedAtDefault,
  recordAction,
  scheduleAction,
  boxAction,
}: Props) {
  const report = view.report;
  const latest = view.latest;

  return (
    <section aria-label="Bike link">
      <h2 className="text-lg font-semibold text-foreground">Bike link</h2>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        The plug stores kilometers, battery voltage, and fault codes. The shop, the
        client&apos;s home, or a partner stop delivers that reading here.
      </p>

      <div className="bike-snapshot-grid mt-3">
        <StatusCard
          label="Service"
          value={report ? SERVICE_LABEL[report.service] : "No reading"}
          detail={
            report?.serviceDetail ?? "A reading has not arrived for this motorcycle yet."
          }
        />
        <StatusCard
          label="Battery"
          value={report ? BATTERY_LABEL[report.battery] : "No reading"}
          detail={report?.batteryDetail ?? "Waiting for a voltage reading."}
        />
        <StatusCard
          label="Faults"
          value={
            report ? (report.faults === "present" ? "Reported" : "None") : "No reading"
          }
          detail={report?.faultDetail ?? "Waiting for a fault-code reading."}
        />
      </div>

      <p className="mt-3 text-sm text-[var(--status-neutral)]">{view.baselineText}</p>

      {latest ? (
        <p className="mt-1 text-sm text-foreground">
          Last reading from {latest.origin}
          {latest.recordedAt ? ` · ${formatDateTime(latest.recordedAt)}` : ""}
          {latest.odometer != null
            ? ` · ${formatMileage(latest.odometer, view.unit)}`
            : ""}
          {latest.batteryVolts != null ? ` · ${latest.batteryVolts.toFixed(1)} V` : ""}
        </p>
      ) : null}

      <div className="mt-3 rounded border border-[var(--border)] bg-white px-4 py-3 text-sm text-foreground">
        {report?.clientNote ? (
          <>
            <p className="font-medium">Tell the client</p>
            <p className="mt-1">{report.clientNote}</p>
            <p className="mt-2 text-[var(--status-neutral)]">
              This stays on the motorcycle page. Send it with the usual client message
              when you want them to know.
            </p>
          </>
        ) : (
          <p>Nothing to tell the client from the latest reading.</p>
        )}
      </div>

      <p className="mt-3 text-sm text-foreground">Box {view.boxId ?? "not paired"}</p>

      {canEdit ? (
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <ReadingForm action={recordAction} recordedAtDefault={recordedAtDefault} />
          <div className="flex flex-col gap-8">
            <BoxForm action={boxAction} boxId={view.boxId} />
            <ScheduleForm action={scheduleAction} view={view} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StatusCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-card-label">{label}</span>
      <span className="stat-card-value text-base">{value}</span>
      <span className="mt-1 text-xs text-[var(--status-neutral)]">{detail}</span>
    </div>
  );
}

function ReadingForm({
  action,
  recordedAtDefault,
}: {
  action: Action;
  recordedAtDefault: string;
}) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-foreground">Record a reading</h3>
      <FormError message={state.error} />
      <label className="block">
        <span className="field-label">Where it was collected</span>
        <select className="select" name="source" defaultValue="shop_bay">
          <option value="shop_bay">Shop</option>
          <option value="home">Home</option>
          <option value="partner">Partner stop</option>
        </select>
      </label>
      <TextField
        label="Place name"
        name="place_name"
        placeholder="Winter storage, cafe, gear shop"
        hint="Leave blank for the shop or home."
      />
      <TextField label="Odometer" name="odometer" inputMode="numeric" />
      <TextField
        label="Battery volts"
        name="battery_volts"
        inputMode="decimal"
        placeholder="12.6"
      />
      <TextField
        label="Fault codes"
        name="fault_codes"
        placeholder="P0335, C14"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      <TextField
        label="Taken at"
        name="recorded_at"
        type="datetime-local"
        defaultValue={recordedAtDefault}
        required
      />
      <div>
        <SubmitButton label="Save reading" pendingLabel="Saving…" />
      </div>
    </form>
  );
}

function BoxForm({ action, boxId }: { action: Action; boxId: string | null }) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-foreground">Box sticker</h3>
      <FormError message={state.error} />
      <TextField
        label="Box id"
        name="box_id"
        defaultValue={boxId ?? ""}
        placeholder="TM-BL-0007"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      <div>
        <SubmitButton label="Save box" pendingLabel="Saving…" />
      </div>
    </form>
  );
}

function ScheduleForm({ action, view }: { action: Action; view: BikeLinkView }) {
  const [state, formAction] = useActionState(action, { error: null });
  const distanceLabel =
    view.unit === "mi" ? "Miles between services" : "Kilometres between services";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-foreground">Service interval</h3>
      <p className="text-sm text-[var(--status-neutral)]">
        Leave the last-service fields blank to keep using the last completed visit.
      </p>
      <FormError message={state.error} />
      <TextField
        label={distanceLabel}
        name="interval_distance"
        inputMode="numeric"
        defaultValue={view.scheduleForm.intervalDistance}
        required
      />
      <TextField
        label="Days between services"
        name="interval_days"
        inputMode="numeric"
        defaultValue={view.scheduleForm.intervalDays}
        required
      />
      <TextField
        label="Last service odometer"
        name="last_service_odometer"
        inputMode="numeric"
        defaultValue={view.scheduleForm.lastServiceOdometer}
      />
      <TextField
        label="Last service date"
        name="last_service_on"
        type="date"
        defaultValue={view.scheduleForm.lastServiceOn}
      />
      <div>
        <SubmitButton label="Save interval" pendingLabel="Saving…" />
      </div>
    </form>
  );
}
