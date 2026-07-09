import Link from "next/link";
import { searchCustomers } from "@/lib/services/customers";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const customers = await searchCustomers(q);

  return (
    <div className="page-stack">
      <PageHeader
        title="Customers"
        subtitle="Search and manage customer records."
        actions={
          <Link href="/customers/new" className="btn btn-primary">
            New customer
          </Link>
        }
      />

      <form method="get" className="filter-panel sm:grid-cols-1 lg:grid-cols-2">
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="field-label">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Name, phone, or email"
            aria-label="Search customers"
            className="input"
          />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">
            Search
          </button>
          {q ? (
            <Link href="/customers" className="btn btn-secondary">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {customers.length === 0 ? (
        <EmptyState
          title={q ? "No matches" : "No customers yet"}
          description={
            q
              ? `No customers match “${q}”. Try a different search or add a new customer.`
              : "Add your first customer to start creating work orders."
          }
          action={
            q
              ? { href: "/customers/new", label: "New customer" }
              : { href: "/customers/new", label: "Add customer" }
          }
        />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.customer_id}>
                  <td>
                    <Link
                      href={`/customers/${customer.customer_id}`}
                      className="data-table-link"
                    >
                      {customer.first_name} {customer.last_name}
                    </Link>
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {customer.phone ?? "—"}
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {customer.email ?? "—"}
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
