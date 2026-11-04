import type { CustomerGlance } from "@/lib/customers/glance";
import { formatDate } from "@/lib/datetime/format";

const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-white px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

export function CustomerAtAGlance({
  createdAt,
  glance,
  smsOptedOutAt,
}: {
  createdAt: string;
  glance: CustomerGlance;
  smsOptedOutAt: string | null;
}) {
  const since = formatDate(createdAt) || "—";
  const lastVisit = glance.last_visit_at ? formatDate(glance.last_visit_at) || "—" : "—";

  return (
    <section aria-label="Customer at a glance">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Fact label="Customer since" value={since} />
        <Fact label="Open visits" value={String(glance.open_visit_count)} />
        <Fact label="Completed" value={String(glance.completed_visit_count)} />
        <Fact label="Last visit" value={lastVisit} />
        <Fact label="Collected" value={cad.format(glance.collected_cents / 100)} />
        {smsOptedOutAt ? <Fact label="Texts" value="Opted out of texts" /> : null}
      </dl>
    </section>
  );
}
