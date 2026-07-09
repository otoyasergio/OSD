import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  DASHBOARD_CARDS,
  getDashboardData,
  type DashboardCardKey,
} from "@/lib/services/dashboard";
import { FlagBadges } from "@/components/status/FlagBadges";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import type { WorkOrderStatus } from "@/lib/database/types";

export const dynamic = "force-dynamic";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Operational view for the active location.
        </p>
      </div>

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
              className={`min-h-11 rounded border px-3 py-3 ${
                active
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400"
              }`}
            >
              <span className="block text-xs font-medium uppercase tracking-wide opacity-80">
                {card.label}
              </span>
              <span className="mt-1 block text-2xl font-semibold tabular-nums">
                {data.counts[card.key]}
              </span>
            </Link>
          );
        })}
      </div>

      <form
        method="get"
        className="grid gap-3 rounded border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        {data.filters.card ? (
          <input type="hidden" name="card" value={data.filters.card} />
        ) : null}
        <label className="block lg:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            Search
          </span>
          <input
            className={SELECT_CLASS}
            name="q"
            type="search"
            defaultValue={data.filters.q ?? ""}
            placeholder="WO #, customer, bike, VIN…"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            Status
          </span>
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
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            Technician
          </span>
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
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            Flag
          </span>
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
          <button
            type="submit"
            className="min-h-11 rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            Apply filters
          </button>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center rounded border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Clear
          </Link>
        </div>
      </form>

      {data.rows.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          No work orders match these filters at this location.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Bike</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Tech</th>
                <th className="px-4 py-3 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((wo) => (
                <tr
                  key={wo.work_order_id}
                  className="border-b border-zinc-100 last:border-0"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/work_orders/${wo.work_order_id}`}
                      className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                    >
                      {wo.work_order_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {wo.external_invoice_number ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {wo.motorcycle?.customer
                      ? `${wo.motorcycle.customer.first_name} ${wo.motorcycle.customer.last_name}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {wo.motorcycle
                      ? `${wo.motorcycle.year} ${wo.motorcycle.make} ${wo.motorcycle.model}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {WORK_ORDER_STATUS_LABELS[wo.status] ?? wo.status}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {wo.primary_technician
                      ? `${wo.primary_technician.first_name} ${wo.primary_technician.last_name}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
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
