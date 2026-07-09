import Link from "next/link";
import { searchCustomers } from "@/lib/services/customers";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const customers = await searchCustomers(q);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Customers
        </h1>
        <Link
          href="/customers/new"
          className="min-h-11 rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          New customer
        </Link>
      </div>

      <form method="get" className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name, phone, or email"
          aria-label="Search customers"
          className="min-h-11 w-full max-w-md rounded border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900"
        />
        <button
          type="submit"
          className="min-h-11 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
        >
          Search
        </button>
      </form>

      {customers.length === 0 ? (
        <p className="mt-8 rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          {q ? `No customers match “${q}”.` : "No customers yet."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr
                  key={customer.customer_id}
                  className="border-b border-zinc-100 last:border-0"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${customer.customer_id}`}
                      className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                    >
                      {customer.first_name} {customer.last_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {customer.phone ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
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
