import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { loadAuctionPriceGuide } from "@/lib/services/auctionPriceGuide";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  canCompleteInspection,
  canCreateRecommendation,
  canOverrideWorkOrderStatus,
  isFloorTech,
  staffHomePath,
} from "@/lib/permissions";
import { getInspectionForWorkOrder } from "@/lib/services/inspections";
import { latestInspectionScan } from "@/lib/services/inspectionScans";
import { isInspectionReadOnly } from "@/lib/services/inspectionGate";
import { InspectionChecklist } from "@/components/inspections/InspectionChecklist";
import { IntakeCompleteNotice } from "@/components/work_orders/IntakeCompleteNotice";
import type { IntakeFollowUp } from "@/lib/forms/intakeCompletion";
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
  searchParams: Promise<{
    returnTo?: string | string[];
    intake?: string;
    follow_up?: string;
  }>;
}) {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  const { role: viewRole } = preview;

  const { work_order_id } = await params;
  const query = await searchParams;
  const intakeFollowUp: IntakeFollowUp | undefined =
    query.follow_up === "signature" || query.follow_up === "paper_copy"
      ? query.follow_up
      : undefined;
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
  const bike = inspection.header.motorcycle;
  const scan = await latestInspectionScan(work_order_id);
  const auction = bike
    ? await loadAuctionPriceGuide({
        motorcycleId: bike.motorcycle_id,
        bike: { year: bike.year, make: bike.make, model: bike.model },
        audience: "staff",
      })
    : null;
  if (auction?.refreshInBackground && bike) {
    after(() => {
      void loadAuctionPriceGuide({
        motorcycleId: bike.motorcycle_id,
        bike: { year: bike.year, make: bike.make, model: bike.model },
        audience: "staff",
        refresh: "force",
      }).catch(() => undefined);
    });
  }

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
        {query.intake === "complete" ? (
          <IntakeCompleteNotice followUp={intakeFollowUp} />
        ) : null}
        {!readOnly ? (
          <p className="inspection-fullscreen-hint">
            Mark every line OK, Future, or Now. “Doesn’t apply” needs a real reason. Enter
            every measurement. Photograph front and rear tires, front and rear brakes,
            forks, and the other evidence slots. Sign the report at the end.
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
          scan={scan}
          canEdit={canEdit}
          canForceComplete={canForce}
          canRecommend={canRecommend}
          completeReturnTo={completeReturnTo}
          auctionGuide={auction?.view ?? null}
        />
      </div>
    </>
  );
}
