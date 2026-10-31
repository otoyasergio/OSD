import type { PassportSnapshotPayload } from "@/lib/passport/schema";

type Props = {
  payload: PassportSnapshotPayload;
  showDownloadNotice?: boolean;
  titleLevel?: 1 | 2;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function PassportReport({
  payload,
  showDownloadNotice = false,
  titleLevel = 1,
}: Props) {
  const vehicleLabel = `${payload.vehicle.year} ${payload.vehicle.make} ${payload.vehicle.model}`;
  const Title = titleLevel === 1 ? "h1" : "h2";

  return (
    <article className="passport-report rounded-lg border border-[var(--border-strong)] bg-white p-5 text-foreground shadow-sm print:border-0 print:p-0 print:shadow-none">
      <header className="border-b border-[var(--border)] pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--status-neutral)]">
          {payload.issuer.legal_name}
        </p>
        <Title className="mt-2 text-2xl font-semibold tracking-tight">
          Vehicle service passport
        </Title>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          {payload.passport_number} · Version {payload.report_version} · Issued{" "}
          {formatDate(payload.issued_at)}
        </p>
      </header>

      <section className="grid gap-3 border-b border-[var(--border)] py-5 sm:grid-cols-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
            Motorcycle
          </h2>
          <p className="mt-1 text-lg font-semibold">{vehicleLabel}</p>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            {payload.vehicle.colour ? `${payload.vehicle.colour} · ` : null}
            VIN {payload.vehicle.vin ?? "not recorded"}
          </p>
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
            Coverage
          </h2>
          <p className="mt-1 text-sm">
            OTOMOTO records through {formatDate(payload.coverage_through)}
          </p>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            {payload.issuer.address} · {payload.issuer.phone}
          </p>
        </div>
      </section>

      <section className="py-5">
        <h2 className="text-lg font-semibold">Documented services</h2>
        <div className="mt-4 flex flex-col gap-4">
          {payload.service_entries.map((entry) => (
            <section
              key={`${entry.service_date}-${entry.work_order_reference}`}
              className="rounded border border-[var(--border)] p-4 break-inside-avoid"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{formatDate(entry.service_date)}</h3>
                <p className="text-xs text-[var(--status-neutral)]">
                  {entry.work_order_reference} · {entry.location}
                </p>
              </div>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
                {entry.source_label}
                {entry.mileage
                  ? ` · ${entry.mileage.value.toLocaleString("en-CA")} ${entry.mileage.unit}`
                  : null}
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {entry.completed_services.map((service, index) => (
                  <li key={`${service}-${index}`}>{service}</li>
                ))}
              </ul>
              {entry.installed_parts.length > 0 ? (
                <div className="mt-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
                    Installed parts
                  </h4>
                  <ul className="mt-1 space-y-1 text-sm">
                    {entry.installed_parts.map((part, index) => (
                      <li key={`${part.part_number ?? part.description}-${index}`}>
                        {formatQuantity(part.quantity)} × {part.description}
                        {part.part_number ? ` · ${part.part_number}` : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </section>

      <footer className="border-t border-[var(--border)] pt-5">
        <h2 className="text-sm font-semibold">Coverage limits</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--status-neutral)]">
          {payload.limitations.map((limitation, index) => (
            <li key={`${limitation}-${index}`}>{limitation}</li>
          ))}
        </ul>
        {showDownloadNotice ? (
          <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:border print:bg-transparent">
            Access to this page can be revoked. Downloaded or printed copies cannot be
            revoked.
          </p>
        ) : null}
      </footer>
    </article>
  );
}
