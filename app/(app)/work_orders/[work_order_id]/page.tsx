import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  canAssignTechnician,
  canCompleteInspection,
  canCompleteJob,
  canCompleteWorkOrder,
  canConvertRecommendation,
  canCreateRecommendation,
  canCreateWorkOrder,
  canEditWorkOrder,
  canMarkReadyForPickup,
  canOrderPart,
  canOverrideWorkOrderStatus,
  canRecordCustomerApproval,
  canRunQualityCheck,
} from "@/lib/permissions";
import {
  getWorkOrderDetail,
  listTechniciansForActiveLocation,
} from "@/lib/services/workOrders";
import { listServices } from "@/lib/services/serviceCatalogue";
import { getInspectionForWorkOrder } from "@/lib/services/inspections";
import { listRecommendationsForWorkOrder } from "@/lib/services/recommendations";
import { listPartsForWorkOrder } from "@/lib/services/parts";
import { listIntakePhotos } from "@/lib/services/photos";
import { listTechnicianNotes } from "@/lib/services/notes";
import { listTimelineEvents } from "@/lib/services/timeline";
import { WorkOrderHeader } from "@/components/work_orders/WorkOrderHeader";
import {
  ComingSoonPanel,
  WORK_ORDER_TABS,
  WorkOrderTabs,
  type WorkOrderTabId,
} from "@/components/work_orders/WorkOrderTabs";
import { OverviewTab } from "@/components/work_orders/OverviewTab";
import { JobsTab } from "@/components/jobs/JobsTab";
import { InspectionChecklist } from "@/components/inspections/InspectionChecklist";
import { RecommendationsTab } from "@/components/recommendations/RecommendationsTab";
import { PartsTab } from "@/components/parts/PartsTab";
import { PhotosTab } from "@/components/photos/PhotosTab";
import { TechnicianNotes } from "@/components/work_orders/TechnicianNotes";
import { TimelineList } from "@/components/timeline/TimelineList";
import {
  assignTechnicianAction,
  setPrimaryTechnicianAction,
} from "@/app/(app)/work_orders/actions";
import {
  addJobAction,
  approveJobAction,
  assignJobTechnicianAction,
  cancelJobAction,
  declineJobAction,
  updateJobStatusAction,
} from "@/app/(app)/work_orders/job-actions";
import {
  convertRecommendationAction,
  createRecommendationAction,
  updateRecommendationStatusAction,
} from "@/app/(app)/work_orders/recommendation-actions";
import {
  addPartAction,
  updatePartStatusAction,
} from "@/app/(app)/work_orders/part-actions";
import { uploadIntakePhotoAction } from "@/app/(app)/work_orders/photo-actions";
import { addTechnicianNoteAction } from "@/app/(app)/work_orders/note-actions";
import {
  cancelWorkOrderAction,
  completeQualityCheckAction,
  completeWorkOrderAction,
  markReadyForPickupAction,
  placeWorkOrderOnHoldAction,
  resumeWorkOrderFromHoldAction,
} from "@/app/(app)/work_orders/quality-actions";

export const dynamic = "force-dynamic";

function isTabId(value: string | undefined): value is WorkOrderTabId {
  return WORK_ORDER_TABS.some((tab) => tab.id === value);
}

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ work_order_id: string }>;
  searchParams: Promise<{ tab?: string; from_result?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const { work_order_id } = await params;
  const { tab: tabParam, from_result: fromResultId } = await searchParams;
  const activeTab: WorkOrderTabId = isTabId(tabParam) ? tabParam : "overview";

  const detail = await getWorkOrderDetail(work_order_id);
  if (!detail) notFound();

  const [
    technicians,
    services,
    inspection,
    recommendations,
    parts,
    photos,
    notes,
    timeline,
  ] = await Promise.all([
    detail.is_foreign_location
      ? Promise.resolve([])
      : listTechniciansForActiveLocation(),
    detail.is_foreign_location
      ? Promise.resolve([])
      : listServices({ includeInactive: false }),
    getInspectionForWorkOrder(work_order_id),
    listRecommendationsForWorkOrder(work_order_id),
    listPartsForWorkOrder(work_order_id),
    listIntakePhotos(work_order_id),
    listTechnicianNotes(work_order_id),
    listTimelineEvents(work_order_id),
  ]);

  const canAssign = canAssignTechnician(user.role);
  const canEdit = canEditWorkOrder(user.role);
  const canApprove = canRecordCustomerApproval(user.role);
  const canComplete = canCompleteJob(user.role);
  const canInspect = canCompleteInspection(user.role);
  const canForceInspect = canOverrideWorkOrderStatus(user.role);
  const canRecommend = canCreateRecommendation(user.role);
  const canConvert = canConvertRecommendation(user.role);
  const canManageParts = canOrderPart(user.role) || canEditWorkOrder(user.role);
  const canAdd =
    canCreateWorkOrder(user.role) || canEditWorkOrder(user.role);
  const canUploadPhotos =
    canEditWorkOrder(user.role) ||
    canCreateWorkOrder(user.role) ||
    user.role === "technician";
  const canAddNotes = canComplete || canEdit || canAdd;
  const canRunQc = canRunQualityCheck(user.role);
  const canMarkReady = canMarkReadyForPickup(user.role);
  const canCompleteWo = canCompleteWorkOrder(user.role);
  const canHoldOrCancel =
    canCompleteWorkOrder(user.role) || canOverrideWorkOrderStatus(user.role);
  const canResumeHold = canOverrideWorkOrderStatus(user.role);
  const canOverrideComplete = canOverrideWorkOrderStatus(user.role);

  const fromResult = fromResultId
    ? inspection?.results.find((r) => r.inspection_result_id === fromResultId)
    : null;
  const fromResultDefaults = fromResult
    ? {
        description: `${fromResult.item_name_snapshot} (${fromResult.category_snapshot})`,
        severity:
          fromResult.status === "immediate_attention"
            ? "immediate_attention"
            : "future_attention",
      }
    : null;

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
          canRunQc={canRunQc}
          canMarkReady={canMarkReady}
          canComplete={canCompleteWo}
          canHoldOrCancel={canHoldOrCancel}
          canResumeHold={canResumeHold}
          canOverrideComplete={canOverrideComplete}
          readOnly={detail.is_foreign_location}
          assignAction={assignTechnicianAction.bind(null, detail.work_order_id)}
          setPrimaryAction={setPrimaryTechnicianAction.bind(
            null,
            detail.work_order_id
          )}
          qcAction={completeQualityCheckAction.bind(null, detail.work_order_id)}
          readyAction={markReadyForPickupAction.bind(null, detail.work_order_id)}
          completeAction={completeWorkOrderAction.bind(
            null,
            detail.work_order_id
          )}
          cancelAction={cancelWorkOrderAction.bind(null, detail.work_order_id)}
          holdAction={placeWorkOrderOnHoldAction.bind(
            null,
            detail.work_order_id
          )}
          resumeAction={resumeWorkOrderFromHoldAction.bind(
            null,
            detail.work_order_id
          )}
        />
      ) : null}

      {activeTab === "jobs" ? (
        <JobsTab
          jobs={detail.jobs}
          services={services}
          technicians={technicians}
          readOnly={detail.is_foreign_location}
          canAdd={canAdd}
          canApprove={canApprove}
          canEdit={canEdit}
          canComplete={canComplete}
          currentUserId={user.user_id}
          addAction={addJobAction.bind(null, detail.work_order_id)}
          assignActionFor={(jobId) =>
            assignJobTechnicianAction.bind(null, detail.work_order_id, jobId)
          }
          statusActionFor={(jobId) =>
            updateJobStatusAction.bind(null, detail.work_order_id, jobId)
          }
          approveActionFor={(jobId) =>
            approveJobAction.bind(null, detail.work_order_id, jobId)
          }
          declineActionFor={(jobId) =>
            declineJobAction.bind(null, detail.work_order_id, jobId)
          }
          cancelActionFor={(jobId) =>
            cancelJobAction.bind(null, detail.work_order_id, jobId)
          }
        />
      ) : null}

      {activeTab === "inspection" ? (
        inspection ? (
          <div className="flex flex-col gap-3">
            <Link
              href={`/work_orders/${detail.work_order_id}/inspection`}
              className="text-sm text-zinc-600 underline-offset-2 hover:underline"
            >
              Open full inspection screen →
            </Link>
            <InspectionChecklist
              inspection={inspection}
              canEdit={canInspect}
              canForceComplete={canForceInspect}
              recommendHref={
                canRecommend
                  ? (result) =>
                      `/work_orders/${detail.work_order_id}?tab=recommendations&from_result=${result.inspection_result_id}`
                  : undefined
              }
            />
          </div>
        ) : (
          <ComingSoonPanel title="Inspection" />
        )
      ) : null}

      {activeTab === "recommendations" ? (
        <RecommendationsTab
          recommendations={recommendations}
          services={services}
          readOnly={detail.is_foreign_location}
          canCreate={canRecommend}
          canUpdateStatus={canApprove || canRecommend}
          canConvert={canConvert}
          createAction={createRecommendationAction.bind(
            null,
            detail.work_order_id
          )}
          statusActionFor={(recommendationId) =>
            updateRecommendationStatusAction.bind(
              null,
              detail.work_order_id,
              recommendationId
            )
          }
          convertActionFor={(recommendationId) =>
            convertRecommendationAction.bind(
              null,
              detail.work_order_id,
              recommendationId
            )
          }
          fromResultId={fromResultId ?? null}
          fromResultDefaults={fromResultDefaults}
        />
      ) : null}

      {activeTab === "parts" ? (
        <PartsTab
          parts={parts}
          jobs={detail.jobs}
          readOnly={detail.is_foreign_location}
          canManage={canManageParts}
          canInstall={canComplete}
          addAction={addPartAction.bind(null, detail.work_order_id)}
          statusActionFor={(partId) =>
            updatePartStatusAction.bind(null, detail.work_order_id, partId)
          }
        />
      ) : null}
      {activeTab === "photos" ? (
        <PhotosTab
          photos={photos}
          readOnly={detail.is_foreign_location}
          canUpload={canUploadPhotos}
          uploadAction={uploadIntakePhotoAction.bind(
            null,
            detail.work_order_id
          )}
        />
      ) : null}
      {activeTab === "notes" ? (
        <TechnicianNotes
          notes={notes}
          jobs={detail.jobs}
          readOnly={detail.is_foreign_location}
          canAdd={canAddNotes}
          addAction={addTechnicianNoteAction.bind(null, detail.work_order_id)}
        />
      ) : null}
      {activeTab === "timeline" ? <TimelineList events={timeline} /> : null}
      {activeTab === "service-info" ? (
        <ComingSoonPanel title="Service Info" />
      ) : null}
    </div>
  );
}
