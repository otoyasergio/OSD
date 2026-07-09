import Link from "next/link";
import { searchMotorcycles } from "@/lib/services/motorcycles";

export default async function MotorcyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const motorcycles = await searchMotorcycles(q);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Motorcycles
        </h1>
        <Link
          href="/motorcycles/new"
          className="min-h-11 rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          New motorcycle
        </Link>
      </div>

      <form method="get" className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search customer, year, make, model, or VIN"
          aria-label="Search motorcycles"
          className="min-h-11 w-full max-w-md rounded border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900"
        />
        <button
          type="submit"
          className="min-h-11 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
        >
          Search
        </button>
      </form>

      {motorcycles.length === 0 ? (
        <p className="mt-8 rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          {q ? `No motorcycles match “${q}”.` : "No motorcycles yet."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-medium">Motorcycle</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">VIN</th>
              </tr>
            </thead>
            <tbody>
              {motorcycles.map((motorcycle) => (
                <tr
                  key={motorcycle.motorcycle_id}
                  className="border-b border-zinc-100 last:border-0"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/motorcycles/${motorcycle.motorcycle_id}`}
                      className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                    >
                      {motorcycle.year} {motorcycle.make} {motorcycle.model}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {motorcycle.customer
                      ? `${motorcycle.customer.first_name} ${motorcycle.customer.last_name}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {motorcycle.vin ?? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
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
