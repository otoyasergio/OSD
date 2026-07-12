import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  canCompleteInspection,
  canCreateRecommendation,
  canOverrideWorkOrderStatus,
} from "@/lib/permissions";
import { getInspectionForWorkOrder } from "@/lib/services/inspections";
import { InspectionChecklist } from "@/components/inspections/InspectionChecklist";

export const dynamic = "force-dynamic";

export default async function InspectionPage({
  params,
}: {
  params: Promise<{ work_order_id: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const { work_order_id } = await params;
  const inspection = await getInspectionForWorkOrder(work_order_id);
  if (!inspection) notFound();

  const canEdit = canCompleteInspection(user.role);
  const canForce = canOverrideWorkOrderStatus(user.role);
  const canRecommend = canCreateRecommendation(user.role);

  return (
    <>
      <header className="inspection-fullscreen-bar">
        <Link
          href={`/work_orders/${work_order_id}?tab=inspection`}
          className="inspection-fullscreen-back"
        >
          ← Back
        </Link>
        <div className="inspection-fullscreen-title">
          <span className="inspection-fullscreen-wo">
            {inspection.work_order_number}
          </span>
          <span className="inspection-fullscreen-label">
            Visual Motorcycle Inspection Report
          </span>
        </div>
      </header>

      <div className="inspection-fullscreen-body">
        <p className="inspection-fullscreen-hint">
          Tap green / yellow / red to mark each item. Status saves immediately.
          Add required photos for tires, brakes, forks, and anything marked
          needing work before completing the report.
        </p>

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
        />
      </div>
    </>
  );
}
