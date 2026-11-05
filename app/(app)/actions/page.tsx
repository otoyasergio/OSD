import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canEditWorkOrder } from "@/lib/permissions";
import { listClientActions } from "@/lib/services/clientActions";
import { toFormErrorMessage } from "@/lib/services/errors";
import { ClientActionCard } from "@/components/actions/ClientActionCard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function ClientActionsPage() {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canEditWorkOrder(preview.role)) redirect("/dashboard");

  let items: Awaited<ReturnType<typeof listClientActions>> = [];
  let loadError: string | null = null;
  try {
    items = await listClientActions();
  } catch (error) {
    loadError = toFormErrorMessage(error);
  }

  return (
    <div className="page-stack page-stack--wide">
      <PageHeader
        title="Client actions"
        subtitle="Prompts to text a customer. Nothing sends until you write the message."
      />
      {loadError ? (
        <p className="card card-pad text-sm text-[var(--status-danger)]" role="alert">
          {loadError}
        </p>
      ) : items.length === 0 ? (
        <p className="card card-pad text-sm text-[var(--status-neutral)]">
          Nothing to text right now.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={`${item.reason}:${item.cycleKey}`}>
              <ClientActionCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
