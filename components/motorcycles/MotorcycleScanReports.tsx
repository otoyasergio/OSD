import Link from "next/link";
import { formatDateTime } from "@/lib/datetime/format";
import {
  readOdometer,
  scanCustomerLines,
  type ScanOutcome,
} from "@/lib/email/scanReport";
import { formatMileage } from "@/lib/mileage/format";
import type { BikeScanReport } from "@/lib/services/motorcycleScans";

const OUTCOME_LABEL: Record<ScanOutcome, string> = {
  codes: "Codes found",
  no_codes: "No fault codes",
  no_connection: "No connection",
  needs_confirmation: "Needs a look",
};

export function MotorcycleScanReports({ reports }: { reports: BikeScanReport[] }) {
  return (
    <section aria-label="Scan reports">
      <h2 className="text-lg font-semibold text-foreground">Scan reports</h2>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        TopGuru reports for this bike, including ones that arrived with no open visit.
      </p>
      {reports.length === 0 ? (
        <p className="mt-3 rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-8 text-center text-sm text-[var(--status-neutral)]">
          No scan reports for this bike yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-white">
          {reports.map((report) => {
            const lines = scanCustomerLines(report);
            const mileage = readOdometer(report.reportText);
            return (
              <li key={report.scanReportId} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {OUTCOME_LABEL[report.outcome]}
                  </p>
                  <p className="text-xs text-[var(--status-neutral)]">
                    {formatDateTime(report.receivedAt)}
                    {mileage?.unit
                      ? ` · ${formatMileage(mileage.value, mileage.unit)}`
                      : null}
                  </p>
                </div>
                {lines.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {lines.map((line) => (
                      <li key={line} className="text-sm text-foreground">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : report.outcome === "needs_confirmation" ? (
                  <p className="mt-2 text-sm text-[var(--status-neutral)]">
                    {report.reportText.slice(0, 280)}
                  </p>
                ) : null}
                {report.workOrderId ? (
                  <p className="mt-2 text-sm">
                    <Link
                      href={`/work_orders/${report.workOrderId}/inspection`}
                      className="underline-offset-2 hover:underline"
                    >
                      {report.workOrderNumber ?? "Open visit"}
                    </Link>
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-[var(--status-neutral)]">
                    No open visit
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
