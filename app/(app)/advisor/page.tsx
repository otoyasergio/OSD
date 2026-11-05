import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canEditWorkOrder } from "@/lib/permissions";
import { listAdvisorQueue, type AdvisorQueueRow } from "@/lib/services/advisorDesk";
import { toFormErrorMessage } from "@/lib/services/errors";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { advisorIcon } from "@/components/ui/shopIcons";
import type { AdvisorQueueKind } from "@/lib/accountability/stageContract";
import { formatDateTime } from "@/lib/datetime/format";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<AdvisorQueueKind, string> = {
  unanswered_message: "Unanswered message",
  pending_approval: "Approval waiting",
  overdue_parts: "Parts overdue",
  missed_promise: "Promise missed",
  customer_update: "Customer update",
};

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
        <EmptyState
          variant="work-orders"
          title="Nothing is waiting on the desk"
          description="Bikes with no advisor, and bikes waiting on a message, an approval, parts, a promise, or a customer update, show up here."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.work_order_id}>
              <Link
                href={`/work_orders/${row.work_order_id}`}
                className="card card-pad block space-y-2 transition-shadow active:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="wo-number-stamp">{row.work_order_number}</span>
                  <span className="text-sm text-[var(--status-neutral)]">
                    {WORK_ORDER_STATUS_LABELS[row.status] ?? row.status}
                  </span>
                </div>
                <p className="advisor-row-title">{row.bike_label}</p>
                <p className="text-sm text-[var(--status-neutral)]">
                  {row.customer_name}
                </p>
                {row.kinds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {row.kinds.map((kind) => {
                      const Icon = advisorIcon(kind);
                      return (
                        <span
                          key={kind}
                          className="badge bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]"
                        >
                          <Icon size={14} aria-hidden strokeWidth={2.25} />
                          {KIND_LABEL[kind]}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span className="badge bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]">
                    No advisor of record
                  </span>
                )}
                <p className="text-sm text-[var(--status-neutral)]">
                  {row.contract.responsibleName
                    ? `${row.contract.responsibleName}. `
                    : ""}
                  {row.contract.evidenceMissing
                    ? `Missing: ${row.contract.evidenceMissing}. `
                    : ""}
                  Next: {row.contract.nextAction}.
                  {row.contract.deadline
                    ? ` Due ${formatDateTime(row.contract.deadline)} Toronto.`
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
