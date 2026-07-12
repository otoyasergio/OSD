import Link from "next/link";
import { searchCustomers } from "@/lib/services/customers";
import { MotorcycleForm } from "@/components/forms/MotorcycleForm";
import { createMotorcycleAction } from "@/app/(app)/motorcycles/actions";

export default async function NewMotorcyclePage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>;
}) {
  const { customer_id } = await searchParams;
  const customers = await searchCustomers("");

  return (
    <div>
      <Link
        href="/motorcycles"
        className="text-sm text-zinc-600 underline-offset-2 hover:underline"
      >
        ← Motorcycles
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
        New motorcycle
      </h1>

      {customers.length === 0 ? (
        <p className="mt-6 rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          Create a customer first, then add their motorcycle.
        </p>
      ) : (
        <div className="mt-6">
          <MotorcycleForm
            action={createMotorcycleAction}
            customers={customers}
            defaultCustomerId={customer_id}
            submitLabel="Create motorcycle"
          />
        </div>
      )}
    </div>
  );
}
