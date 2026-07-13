import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canCreateWorkOrder } from "@/lib/permissions";
import { getCustomerById, searchCustomers } from "@/lib/services/customers";
import { getMotorcycleById, searchMotorcycles } from "@/lib/services/motorcycles";
import { listServices } from "@/lib/services/serviceCatalogue";
import { listTechniciansForActiveLocation } from "@/lib/services/workOrders";
import { CreateWorkOrderFormLazy } from "@/components/forms/CreateWorkOrderFormLazy";

export const dynamic = "force-dynamic";

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string; motorcycle_id?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canCreateWorkOrder(user.role)) redirect("/work_orders");

  const { customer_id = "", motorcycle_id = "" } = await searchParams;

  const [customers, motorcycles, services, technicians] = await Promise.all([
    searchCustomers(""),
    searchMotorcycles(""),
    listServices({ includeInactive: false }),
    listTechniciansForActiveLocation(),
  ]);

  // search* caps at 50; deep links must still resolve the selected records.
  let customerOptions = customers;
  if (customer_id && !customers.some((c) => c.customer_id === customer_id)) {
    const selected = await getCustomerById(customer_id);
    if (selected) customerOptions = [selected, ...customers];
  }

  let motorcycleOptions = motorcycles;
  if (motorcycle_id && !motorcycles.some((m) => m.motorcycle_id === motorcycle_id)) {
    const selected = await getMotorcycleById(motorcycle_id);
    if (selected) motorcycleOptions = [selected, ...motorcycles];
  }

  return (
    <div>
      <Link
        href="/work_orders"
        className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
      >
        ← Work orders
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        New work order
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--status-neutral)]">
        Guided intake: customer, motorcycle, visit details, and all six photos — then
        review and create under your active location.
      </p>

      <div className="mt-6">
        <CreateWorkOrderFormLazy
          customers={customerOptions}
          motorcycles={motorcycleOptions}
          services={services}
          technicians={technicians}
          initialCustomerId={customer_id}
          initialMotorcycleId={motorcycle_id}
        />
      </div>
    </div>
  );
}
