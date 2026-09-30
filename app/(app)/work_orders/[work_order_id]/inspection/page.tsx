import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  canCompleteInspection,
  canCreateRecommendation,
  canOverrideWorkOrderStatus,
  isFloorTech,
  staffHomePath,
} from "@/lib/permissions";
import { getInspectionForWorkOrder } from "@/lib/services/inspections";
import { isInspectionReadOnly } from "@/lib/services/inspectionGate";
import { InspectionChecklist } from "@/components/inspections/InspectionChecklist";
import {
  floorWorkReturnFromInspectBack,
  safeFloorReturnTo,
} from "@/lib/technician/assignmentHref";

export const dynamic = "force-dynamic";

export default async function InspectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ work_order_id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  const { role: viewRole } = preview;

  const { work_order_id } = await params;
  const query = await searchParams;
  const floorReturn = safeFloorReturnTo(query.returnTo);
  const backHref = floorReturn ?? `/work_orders/${work_order_id}?tab=inspection`;
  const backLabel = floorReturn ? "← Back to Tech floor" : "← Back";
  const completeReturnTo = floorReturn
    ? floorWorkReturnFromInspectBack(floorReturn)
    : null;

  const inspection = await getInspectionForWorkOrder(work_order_id, {
    view: { role: viewRole, subjectUserId: preview.subjectUserId },
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "FORBIDDEN") {
      redirect(isFloorTech(viewRole) ? staffHomePath(viewRole) : "/dashboard");
    }
    throw error;
  });
  if (!inspection) notFound();

  const canEdit = canCompleteInspection(viewRole);
  const canForce = canOverrideWorkOrderStatus(viewRole);
  const canRecommend = canCreateRecommendation(viewRole);
  const readOnly = isInspectionReadOnly({
    is_foreign_location: inspection.is_foreign_location,
    completed_at: inspection.completed_at,
    work_order_status: inspection.work_order_status,
    canEdit,
  });

  return (
    <>
      <header className="inspection-fullscreen-bar">
        <Link href={backHref} className="inspection-fullscreen-back">
          {backLabel}
        </Link>
        <div className="inspection-fullscreen-title">
          <span className="inspection-fullscreen-wo">{inspection.work_order_number}</span>
          <span className="inspection-fullscreen-label">Inspection</span>
        </div>
      </header>

      <div className="inspection-fullscreen-body">
        {!readOnly ? (
          <p className="inspection-fullscreen-hint">
            Tap OK / Future / Now / N/A on each item. Status saves immediately. Add
            required photos before completing the report.
          </p>
        ) : null}

        {inspection.is_foreign_location ? (
          <div
            role="status"
            className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            This work order belongs to another location. Viewing only.
          </div>
        ) : null}

        <InspectionChecklist
          inspection={inspection}
          canEdit={canEdit}
          canForceComplete={canForce}
          canRecommend={canRecommend}
          completeReturnTo={completeReturnTo}
        />
      </div>
    </>
  );
}
