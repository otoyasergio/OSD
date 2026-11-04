"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  SCAN_CLEAR_DTC_NOTE,
  SCAN_NO_CODES_LINE,
  SCAN_NO_CONNECTION_LINE,
  mileageDecision,
  readOdometer,
  scanCustomerLines,
  vinMismatchNote,
  type InspectionScanView,
} from "@/lib/email/scanReport";
import { formatMileage, type MileageUnit } from "@/lib/mileage/format";

type ScanFormState = { error: string | null };

type ScanAction = (prev: ScanFormState, formData: FormData) => Promise<ScanFormState>;

const idle: ScanFormState = { error: null };

export function InspectionScanSection({
  workOrderVin,
  mileage,
  mileageUnit,
  scan,
  readOnly,
  pasteAction,
  noConnectionAction,
  confirmAction,
  mileageAction,
}: {
  workOrderVin: string | null;
  mileage: number | null;
  mileageUnit: MileageUnit;
  scan: InspectionScanView | null;
  readOnly: boolean;
  pasteAction: ScanAction;
  noConnectionAction: ScanAction;
  confirmAction: ScanAction;
  mileageAction: ScanAction;
}) {
  const [pasteState, pasteFormAction] = useActionState(pasteAction, idle);
  const [connectionState, connectionFormAction] = useActionState(noConnectionAction, idle);
  const [confirmState, confirmFormAction] = useActionState(confirmAction, idle);
  const [mileageState, mileageFormAction] = useActionState(mileageAction, idle);
  const lines = scan ? scanCustomerLines(scan) : [];
  const vinNote = scan ? vinMismatchNote(scan.vin, workOrderVin) : null;
  const decision = mileageDecision({
    reported: scan ? readOdometer(scan.reportText) : null,
    current: mileage,
    currentUnit: mileageUnit,
  });
  const showMileageChoice =
    !readOnly && scan != null && scan.mileageChoice !== "keep" && decision.action === "choose";
  const reportedLabel =
    decision.action === "choose"
      ? decision.reportedUnit
        ? formatMileage(decision.reportedValue, decision.reportedUnit)
        : decision.reportedValue.toLocaleString("en-CA")
      : "";

  return (
    <section className="inspection-scan" data-testid="inspection-scan">
      <h2>Scan report</h2>
      <p className="inspection-scan-note">{SCAN_CLEAR_DTC_NOTE}</p>

      {scan && lines.length > 0 ? (
        scan.outcome === "codes" ? (
          <ul className="inspection-scan-codes">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="inspection-scan-result" role="status">
            {lines[0]}
          </p>
        )
      ) : null}

      {scan?.outcome === "needs_confirmation" ? (
        <p className="inspection-scan-raw">{scan.reportText}</p>
      ) : null}

      {vinNote ? (
        <p className="inspection-scan-warning" role="status">
          {vinNote}
        </p>
      ) : null}

      {showMileageChoice && decision.action === "choose" ? (
        <div className="inspection-scan-actions">
          <form action={mileageFormAction}>
            <input type="hidden" name="scan_report_id" value={scan.scanReportId} />
            <input type="hidden" name="choice" value="report" />
            <SubmitButton label={`Use ${reportedLabel}`} pendingLabel="Saving…" />
          </form>
          <form action={mileageFormAction}>
            <input type="hidden" name="scan_report_id" value={scan.scanReportId} />
            <input type="hidden" name="choice" value="keep" />
            <SubmitButton
              label={`Keep ${formatMileage(decision.current, decision.currentUnit)}`}
              pendingLabel="Saving…"
              variant="secondary"
            />
          </form>
        </div>
      ) : null}
      {mileageState.error ? (
        <p className="inspection-scan-warning" role="alert">
          {mileageState.error}
        </p>
      ) : null}

      {!readOnly && scan?.outcome === "needs_confirmation" ? (
        <div className="inspection-scan-actions">
          {scan.codes.length > 0 ? (
            <form action={confirmFormAction}>
              <input type="hidden" name="scan_report_id" value={scan.scanReportId} />
              <input type="hidden" name="outcome" value="codes" />
              <SubmitButton label="Use these codes" pendingLabel="Saving…" />
            </form>
          ) : null}
          <form action={confirmFormAction}>
            <input type="hidden" name="scan_report_id" value={scan.scanReportId} />
            <input type="hidden" name="outcome" value="no_codes" />
            <SubmitButton
              label={SCAN_NO_CODES_LINE}
              pendingLabel="Saving…"
              variant="secondary"
            />
          </form>
          <form action={confirmFormAction}>
            <input type="hidden" name="scan_report_id" value={scan.scanReportId} />
            <input type="hidden" name="outcome" value="no_connection" />
            <SubmitButton
              label={SCAN_NO_CONNECTION_LINE}
              pendingLabel="Saving…"
              variant="secondary"
            />
          </form>
        </div>
      ) : null}
      {confirmState.error ? (
        <p className="inspection-scan-warning" role="alert">
          {confirmState.error}
        </p>
      ) : null}

      {!readOnly ? (
        <div className="inspection-scan-entry">
          <form action={pasteFormAction} className="inspection-scan-paste-form">
            <label className="inspection-scan-label">
              Paste the TopGuru report
              <textarea name="report_text" rows={4} className="inspection-scan-paste" />
            </label>
            <SubmitButton label="Save report" pendingLabel="Saving…" />
          </form>
          {pasteState.error ? (
            <p className="inspection-scan-warning" role="alert">
              {pasteState.error}
            </p>
          ) : null}
          <form action={connectionFormAction}>
            <SubmitButton
              label="Mark no connection"
              pendingLabel="Saving…"
              variant="secondary"
            />
          </form>
          {connectionState.error ? (
            <p className="inspection-scan-warning" role="alert">
              {connectionState.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
