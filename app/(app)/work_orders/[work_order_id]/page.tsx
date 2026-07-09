import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canAssignTechnician } from "@/lib/permissions";
import {
  getWorkOrderDetail,
  listTechniciansForActiveLocation,
} from "@/lib/services/workOrders";
import { WorkOrderHeader } from "@/components/work_orders/WorkOrderHeader";
import {
  ComingSoonPanel,
  WORK_ORDER_TABS,
  WorkOrderTabs,
  type WorkOrderTabId,
} from "@/components/work_orders/WorkOrderTabs";
import { OverviewTab } from "@/components/work_orders/OverviewTab";
import {
  assignTechnicianAction,
  setPrimaryTechnicianAction,
} from "@/app/(app)/work_orders/actions";

export const dynamic = "force-dynamic";

function isTabId(value: string | undefined): value is WorkOrderTabId {
  return WORK_ORDER_TABS.some((tab) => tab.id === value);
}

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ work_order_id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const { work_order_id } = await params;
  const { tab: tabParam } = await searchParams;
  const activeTab: WorkOrderTabId = isTabId(tabParam) ? tabParam : "overview";

  const detail = await getWorkOrderDetail(work_order_id);
  if (!detail) notFound();

  const technicians = detail.is_foreign_location
    ? []
    : await listTechniciansForActiveLocation();

  const canAssign = canAssignTechnician(user.role);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/work_orders"
        className="text-sm text-zinc-600 underline-offset-2 hover:underline"
      >
        ← Work orders
      </Link>

      {detail.is_foreign_location ? (
        <div
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          This work order belongs to another location. You can view it for
          history, but switch location to make changes.
        </div>
      ) : null}

      <WorkOrderHeader detail={detail} />
      <WorkOrderTabs workOrderId={detail.work_order_id} activeTab={activeTab} />

      {activeTab === "overview" ? (
        <OverviewTab
          detail={detail}
          technicians={technicians}
          canAssign={canAssign}
          readOnly={detail.is_foreign_location}
          assignAction={assignTechnicianAction.bind(null, detail.work_order_id)}
          setPrimaryAction={setPrimaryTechnicianAction.bind(
            null,
            detail.work_order_id
          )}
        />
      ) : null}

      {activeTab === "jobs" ? <ComingSoonPanel title="Jobs" /> : null}
      {activeTab === "inspection" ? (
        <ComingSoonPanel title="Inspection" />
      ) : null}
      {activeTab === "recommendations" ? (
        <ComingSoonPanel title="Recommendations" />
      ) : null}
      {activeTab === "parts" ? <ComingSoonPanel title="Parts" /> : null}
      {activeTab === "photos" ? <ComingSoonPanel title="Photos" /> : null}
      {activeTab === "notes" ? <ComingSoonPanel title="Notes" /> : null}
      {activeTab === "timeline" ? <ComingSoonPanel title="Timeline" /> : null}
      {activeTab === "service-info" ? (
        <ComingSoonPanel title="Service Info" />
      ) : null}
    </div>
  );
}
