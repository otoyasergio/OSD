import Link from "next/link";
import { CustomerForm } from "@/components/forms/CustomerForm";
import { createCustomerAction } from "@/app/(app)/customers/actions";

export default function NewCustomerPage() {
  return (
    <div>
      <Link
        href="/customers"
        className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
      >
        ← Customers
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        New customer
      </h1>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        Phone or email is required so the shop can reach the customer.
      </p>

      <div className="mt-6">
        <CustomerForm action={createCustomerAction} submitLabel="Create customer" />
      </div>
    </div>
  );
}
