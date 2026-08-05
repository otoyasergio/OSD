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

export const dynamic = "force-dynamic";

function safeFloorReturnTo(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  try {
    const url = new URL(trimmed, "https://example.invalid");
    if (url.pathname !== "/technician") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

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
          <span className="inspection-fullscreen-label">
            Visual Motorcycle Inspection Report
          </span>
        </div>
      </header>

      <div className="inspection-fullscreen-body">
        {!readOnly ? (
          <p className="inspection-fullscreen-hint">
            Tap green / yellow / red to mark each item. Status saves immediately. Add
            required photos for tires, brakes, forks, and anything marked needing work
            before completing the report.
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
        />
      </div>
    </>
  );
}
