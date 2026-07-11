import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canCreateWorkOrder } from "@/lib/permissions";
import { searchCustomers } from "@/lib/services/customers";
import { searchMotorcycles } from "@/lib/services/motorcycles";
import { listServices } from "@/lib/services/serviceCatalogue";
import { listTechniciansForActiveLocation } from "@/lib/services/workOrders";
import { CreateWorkOrderForm } from "@/components/forms/CreateWorkOrderForm";

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

  return (
    <div>
      <Link
        href="/work_orders"
        className="text-sm text-zinc-600 underline-offset-2 hover:underline"
      >
        ← Work orders
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
        New work order
      </h1>
      <p className="mt-1 text-sm text-zinc-600">
        Step through customer, motorcycle, visit details, and all six intake
        photos — then review and create under your active location.
      </p>

      <div className="mt-6">
        <CreateWorkOrderForm
          customers={customers}
          motorcycles={motorcycles}
          services={services}
          technicians={technicians}
          initialCustomerId={customer_id}
          initialMotorcycleId={motorcycle_id}
        />
      </div>
    </div>
  );
}
