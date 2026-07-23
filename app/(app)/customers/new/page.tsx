import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canViewClients } from "@/lib/permissions";
import { CustomerForm } from "@/components/forms/CustomerForm";
import { createCustomerAction } from "@/app/(app)/customers/actions";

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const user = await requireUser();
  const preview = await getRolePreviewContext();
  if (!canViewClients(preview?.role ?? user.role)) redirect("/dashboard");

  const { return_to = "" } = await searchParams;
  const returnTo =
    return_to.startsWith("/") && !return_to.startsWith("//") ? return_to : undefined;

  return (
    <div>
      <Link
        href={returnTo ?? "/customers"}
        className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
      >
        ← {returnTo ? "Back to intake" : "Customers"}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        New customer
      </h1>
      <div className="mt-5">
        <CustomerForm
          action={createCustomerAction}
          submitLabel="Create customer & add motorcycle"
          returnTo={returnTo}
        />
      </div>
    </div>
  );
}
