import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canViewClients } from "@/lib/permissions";
import { getCustomerById, searchCustomers } from "@/lib/services/customers";
import { MotorcycleForm } from "@/components/forms/MotorcycleForm";
import { createMotorcycleAction } from "@/app/(app)/motorcycles/actions";
import { normalizeVin } from "@/lib/vin";

export default async function NewMotorcyclePage({
  searchParams,
}: {
  searchParams: Promise<{
    customer_id?: string;
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
    return_to?: string;
  }>;
}) {
  const user = await requireUser();
  const preview = await getRolePreviewContext();
  if (!canViewClients(preview?.role ?? user.role)) redirect("/dashboard");

  const {
    customer_id,
    vin: vinRaw = "",
    year = "",
    make = "",
    model = "",
    return_to = "",
  } = await searchParams;
  const customers = await searchCustomers("");
  const vin = vinRaw ? normalizeVin(vinRaw).slice(0, 17) : "";

  // searchCustomers caps at 50; always include the preselected customer from garage/deep links.
  let customerOptions = customers;
  if (customer_id && !customers.some((c) => c.customer_id === customer_id)) {
    const selected = await getCustomerById(customer_id);
    if (selected) {
      customerOptions = [selected, ...customers];
    }
  }

  const returnTo =
    return_to.startsWith("/") && !return_to.startsWith("//") ? return_to : undefined;

  return (
    <div>
      <Link
        href={
          returnTo ? returnTo : customer_id ? `/customers/${customer_id}` : "/motorcycles"
        }
        className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
      >
        ← {returnTo ? "Back to intake" : "Motorcycles"}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        New motorcycle
      </h1>

      {customerOptions.length === 0 ? (
        <p className="mt-6 rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-10 text-center text-[var(--status-neutral)]">
          Create a customer first, then add their motorcycle.
        </p>
      ) : (
        <div className="mt-6">
          <MotorcycleForm
            action={createMotorcycleAction}
            customers={customerOptions}
            defaultCustomerId={customer_id}
            defaults={{
              vin: vin || undefined,
              year: year || undefined,
              make: make || undefined,
              model: model || undefined,
            }}
            returnTo={returnTo}
            submitLabel={
              returnTo ? "Create motorcycle & start work order" : "Create motorcycle"
            }
          />
        </div>
      )}
    </div>
  );
}
