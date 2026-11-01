import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canEditWorkOrder } from "@/lib/permissions";
import { listAdvisorQueue, type AdvisorQueueRow } from "@/lib/services/advisorDesk";
import { toFormErrorMessage } from "@/lib/services/errors";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import { PageHeader } from "@/components/ui/PageHeader";
import type { AdvisorQueueKind } from "@/lib/accountability/stageContract";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<AdvisorQueueKind, string> = {
  unanswered_message: "Unanswered message",
  pending_approval: "Approval waiting",
  overdue_parts: "Parts overdue",
  missed_promise: "Promise missed",
  customer_update: "Customer update",
};

function shopWhen(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default async function AdvisorDeskPage() {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canEditWorkOrder(preview.role)) redirect("/dashboard");

  let rows: AdvisorQueueRow[] = [];
  let loadError: string | null = null;
  try {
    rows = await listAdvisorQueue();
  } catch (error) {
    loadError = toFormErrorMessage(error);
  }

  return (
    <div className="page-stack page-stack--wide">
      <PageHeader
        title="Advisor desk"
        subtitle="Bikes with no advisor, and bikes waiting on a message, an approval, parts, a promise, or a customer update."
      />
      {loadError ? (
        <p className="card card-pad text-sm text-[var(--status-danger)]" role="alert">
          {loadError}
        </p>
      ) : rows.length === 0 ? (
        <p className="card card-pad text-sm text-[var(--status-neutral)]">
          The desk is clear.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.work_order_id}>
              <Link
                href={`/work_orders/${row.work_order_id}`}
                className="card card-pad block space-y-2 transition-shadow active:shadow-md"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    {row.work_order_number} · {row.customer_name}
                  </span>
                  <span className="text-sm text-[var(--status-neutral)]">
                    {WORK_ORDER_STATUS_LABELS[row.status] ?? row.status}
                  </span>
                </div>
                <p className="text-sm text-[var(--status-neutral)]">{row.bike_label}</p>
                {row.kinds.length > 0 ? (
                  <p className="text-sm font-medium text-foreground">
                    {row.kinds.map((kind) => KIND_LABEL[kind]).join(" · ")}
                  </p>
                ) : (
                  <p className="text-sm font-medium text-foreground">
                    No advisor of record
                  </p>
                )}
                <p className="text-sm text-[var(--status-neutral)]">
                  {row.contract.responsibleName
                    ? `${row.contract.responsibleName}. `
                    : ""}
                  {row.contract.evidenceMissing
                    ? `Missing: ${row.contract.evidenceMissing}. `
                    : ""}
                  Next: {row.contract.nextAction}.
                  {shopWhen(row.contract.deadline)
                    ? ` Due ${shopWhen(row.contract.deadline)} Toronto.`
                    : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
