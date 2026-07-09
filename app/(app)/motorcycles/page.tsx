import Link from "next/link";
import {
  countMotorcycles,
  searchMotorcycles,
} from "@/lib/services/motorcycles";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function MotorcyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const [motorcycles, totalMotorcycles] = await Promise.all([
    searchMotorcycles(q),
    countMotorcycles(),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Motorcycles"
        subtitle="Search by customer, year, make, model, or VIN."
        actions={
          <Link href="/motorcycles/new" className="btn btn-primary">
            New motorcycle
          </Link>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:max-w-md">
        <div
          className="stat-card"
          aria-label={`${totalMotorcycles} motorcycles on file`}
        >
          <span className="stat-card-label">Motorcycles on file</span>
          <span className="stat-card-value">{totalMotorcycles}</span>
        </div>
        {q ? (
          <div
            className="stat-card"
            aria-label={`${motorcycles.length} search matches`}
          >
            <span className="stat-card-label">Search matches</span>
            <span className="stat-card-value">{motorcycles.length}</span>
          </div>
        ) : null}
      </div>

      <form method="get" className="filter-panel sm:grid-cols-1 lg:grid-cols-2">
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="field-label">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Customer, year, make, model, or VIN"
            aria-label="Search motorcycles"
            className="input"
          />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">
            Search
          </button>
          {q ? (
            <Link href="/motorcycles" className="btn btn-secondary">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {motorcycles.length === 0 ? (
        <EmptyState
          title={q ? "No matches" : "No motorcycles yet"}
          description={
            q
              ? `No motorcycles match “${q}”. Try a different search or add a new motorcycle.`
              : "Add motorcycles to link customers with their bikes and work orders."
          }
          action={
            q
              ? { href: "/motorcycles/new", label: "New motorcycle" }
              : { href: "/motorcycles/new", label: "Add motorcycle" }
          }
        />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Motorcycle</th>
                <th>Customer</th>
                <th>VIN</th>
              </tr>
            </thead>
            <tbody>
              {motorcycles.map((motorcycle) => (
                <tr key={motorcycle.motorcycle_id}>
                  <td>
                    <Link
                      href={`/motorcycles/${motorcycle.motorcycle_id}`}
                      className="data-table-link"
                    >
                      {motorcycle.year} {motorcycle.make} {motorcycle.model}
                    </Link>
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {motorcycle.customer
                      ? `${motorcycle.customer.first_name} ${motorcycle.customer.last_name}`
                      : "—"}
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {motorcycle.vin ?? (
                      <span className="badge bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]">
                        Missing VIN
                      </span>
                    )}
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
