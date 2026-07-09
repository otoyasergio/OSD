import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  DASHBOARD_CARDS,
  getDashboardData,
  type DashboardCardKey,
} from "@/lib/services/dashboard";
import { FlagBadges } from "@/components/status/FlagBadges";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SELECT_CLASS } from "@/components/forms/Field";
import type { WorkOrderStatus } from "@/lib/database/types";

export const dynamic = "force-dynamic";

function buildHref(params: Record<string, string | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    technician_id?: string;
    flag?: string;
    q?: string;
    card?: string;
  }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const data = await getDashboardData({
    status: (params.status as WorkOrderStatus) || "",
    technician_id: params.technician_id || "",
    flag: params.flag || "",
    q: params.q || "",
    card: (params.card as DashboardCardKey) || "",
  });

  const filterBase = {
    status: data.filters.status || undefined,
    technician_id: data.filters.technician_id || undefined,
    flag: data.filters.flag || undefined,
    q: data.filters.q || undefined,
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Dashboard"
        subtitle="Operational view for the active location."
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {DASHBOARD_CARDS.map((card) => {
          const active = data.filters.card === card.key;
          return (
            <Link
              key={card.key}
              href={buildHref({
                ...filterBase,
                card: active ? undefined : card.key,
              })}
              className={active ? "stat-card stat-card-active" : "stat-card"}
              aria-current={active ? "true" : undefined}
            >
              <span className="stat-card-label">{card.label}</span>
              <span className="stat-card-value">{data.counts[card.key]}</span>
            </Link>
          );
        })}
      </div>

      <form method="get" className="filter-panel">
        {data.filters.card ? (
          <input type="hidden" name="card" value={data.filters.card} />
        ) : null}
        <label className="block lg:col-span-2">
          <span className="field-label">Search</span>
          <input
            className="input"
            name="q"
            type="search"
            defaultValue={data.filters.q ?? ""}
            placeholder="WO #, customer, bike, VIN…"
          />
        </label>
        <label className="block">
          <span className="field-label">Status</span>
          <select
            className={SELECT_CLASS}
            name="status"
            defaultValue={data.filters.status ?? ""}
          >
            <option value="">All statuses</option>
            {data.statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Technician</span>
          <select
            className={SELECT_CLASS}
            name="technician_id"
            defaultValue={data.filters.technician_id ?? ""}
          >
            <option value="">All technicians</option>
            {data.technicians.map((tech) => (
              <option key={tech.user_id} value={tech.user_id}>
                {tech.first_name} {tech.last_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Flag</span>
          <select
            className={SELECT_CLASS}
            name="flag"
            defaultValue={data.filters.flag ?? ""}
          >
            <option value="">All flags</option>
            {data.flagOptions.map((flag) => (
              <option key={flag} value={flag}>
                {flag}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="btn btn-primary">
            Apply filters
          </button>
          <Link href="/dashboard" className="btn btn-secondary">
            Clear
          </Link>
        </div>
      </form>

      {data.rows.length === 0 ? (
        <EmptyState description="No work orders match these filters at this location." />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Bike</th>
                <th>Status</th>
                <th>Tech</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((wo) => (
                <tr key={wo.work_order_id}>
                  <td>
                    <Link
                      href={`/work_orders/${wo.work_order_id}`}
                      className="data-table-link"
                    >
                      {wo.work_order_number}
                    </Link>
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {wo.external_invoice_number ?? "—"}
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {wo.motorcycle?.customer
                      ? `${wo.motorcycle.customer.first_name} ${wo.motorcycle.customer.last_name}`
                      : "—"}
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {wo.motorcycle
                      ? `${wo.motorcycle.year} ${wo.motorcycle.make} ${wo.motorcycle.model}`
                      : "—"}
                  </td>
                  <td>
                    <StatusBadge status={wo.status} />
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {wo.primary_technician
                      ? `${wo.primary_technician.first_name} ${wo.primary_technician.last_name}`
                      : "—"}
                  </td>
                  <td>
                    <FlagBadges flags={wo.flags} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
