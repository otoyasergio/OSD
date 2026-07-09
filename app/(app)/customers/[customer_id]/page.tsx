import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerById } from "@/lib/services/customers";
import { listMotorcyclesForCustomer } from "@/lib/services/motorcycles";
import { CustomerForm } from "@/components/forms/CustomerForm";
import { updateCustomerAction } from "@/app/(app)/customers/actions";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customer_id: string }>;
}) {
  const { customer_id } = await params;
  const customer = await getCustomerById(customer_id);
  if (!customer) notFound();

  const motorcycles = await listMotorcyclesForCustomer(customer_id);
  const updateAction = updateCustomerAction.bind(null, customer_id);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/customers"
          className="text-sm text-zinc-600 underline-offset-2 hover:underline"
        >
          ← Customers
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          {customer.first_name} {customer.last_name}
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          {customer.phone ?? "No phone"} · {customer.email ?? "No email"}
        </p>
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-900">Motorcycles</h2>
          <Link
            href={`/motorcycles/new?customer_id=${customer_id}`}
            className="min-h-11 rounded border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
          >
            Add motorcycle
          </Link>
        </div>
        {motorcycles.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600">
            No motorcycles for this customer yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
            {motorcycles.map((motorcycle) => (
              <li key={motorcycle.motorcycle_id} className="px-4 py-3">
                <Link
                  href={`/motorcycles/${motorcycle.motorcycle_id}`}
                  className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                >
                  {motorcycle.year} {motorcycle.make} {motorcycle.model}
                </Link>
                {motorcycle.vin ? null : (
                  <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    Missing VIN
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-zinc-900">Edit customer</h2>
        <div className="mt-3">
          <CustomerForm
            action={updateAction}
            customer={customer}
            submitLabel="Save changes"
          />
        </div>
      </section>
    </div>
  );
}
