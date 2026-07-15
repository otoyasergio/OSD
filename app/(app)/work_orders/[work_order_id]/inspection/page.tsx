import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  canCompleteInspection,
  canCreateRecommendation,
  canOverrideWorkOrderStatus,
  isFloorTech,
  staffHomePath,
} from "@/lib/permissions";
import { getInspectionForWorkOrder, ensureInspectionStarted } from "@/lib/services/inspections";
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
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const { work_order_id } = await params;
  const query = await searchParams;
  const floorReturn = safeFloorReturnTo(query.returnTo);
  const backHref = floorReturn ?? `/work_orders/${work_order_id}?tab=inspection`;
  const backLabel = floorReturn ? "← Back to Tech floor" : "← Back";

  const inspection = await getInspectionForWorkOrder(work_order_id).catch(
    (error: unknown) => {
      if (error instanceof Error && error.message === "FORBIDDEN") {
        redirect(isFloorTech(user.role) ? staffHomePath(user.role) : "/dashboard");
      }
      throw error;
    }
  );
  if (!inspection) notFound();

  const canEdit = canCompleteInspection(user.role);
  if (canEdit && !inspection.completed_at && !inspection.is_foreign_location) {
    const startedAt = await ensureInspectionStarted(work_order_id).catch(() => null);
    if (startedAt && !inspection.started_at) {
      inspection.started_at = startedAt;
    }
  }

  const canForce = canOverrideWorkOrderStatus(user.role);
  const canRecommend = canCreateRecommendation(user.role);
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
            Tap OK / Future / Now / N/A to mark each item. Status saves immediately.
            Yellow and red items create recommendations automatically. Add required
            photos for tires, brakes, forks, and anything marked needing work. Sign
            when finished — the timer counts down from 20 minutes.
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
