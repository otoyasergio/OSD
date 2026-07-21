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
  canDeleteIntakePhoto,
  canEditWorkOrder,
  canMarkReadyForPickup,
  canOrderPart,
  canOverrideWorkOrderStatus,
  canRecordCustomerApproval,
  canRunQualityCheck,
  canClearAdminFlag,
  canOverrideSafetyRequirement,
  canUpdateServiceInformation,
  canViewClients,
  canViewPartCost,
  canViewPricing,
  isFloorTech,
  staffHomePath,
} from "@/lib/permissions";
import {
  getWorkOrderDetail,
  listTechniciansForActiveLocation,
} from "@/lib/services/workOrders";
import { listServices } from "@/lib/services/serviceCatalogue";
import { getInspectionForWorkOrder } from "@/lib/services/inspections";
import {
  isRecommendationOpenForEstimate,
  listOutstandingRecommendationsForMotorcycle,
  listRecommendationEstimateLines,
  listRecommendationsForWorkOrder,
} from "@/lib/services/recommendations";
import {
  getLiveEstimateForWorkOrder,
  listEstimateVersionHistory,
  type EstimateVersionView,
} from "@/lib/services/estimates";
import { readWorkflowV2Flags, v2WritesEnabled } from "@/lib/config/features";
import { listPartsForWorkOrder } from "@/lib/services/parts";
import { listIntakePhotos } from "@/lib/services/photos";
import { listTechnicianNotes } from "@/lib/services/notes";
import { listTimelineEvents } from "@/lib/services/timeline";
import { getServiceInformation } from "@/lib/services/motorcycles";
import { listCommunicationLog } from "@/lib/services/communications";
import {
  getActiveAgreementTemplate,
  getDropOffAgreement,
} from "@/lib/services/contracts";
import { WorkOrderHeader } from "@/components/work_orders/WorkOrderHeader";
import { IntakeCompleteNotice } from "@/components/work_orders/IntakeCompleteNotice";
import { AgreementFollowUpNotice } from "@/components/work_orders/AgreementFollowUpNotice";
import { ComingSoonPanel, WorkOrderTabs } from "@/components/work_orders/WorkOrderTabs";
import { resolveWorkOrderTabId, type WorkOrderTabId } from "@/lib/workOrders/tabs";
import { EstimateJobsWorkspace } from "@/components/estimates/EstimateJobsWorkspace";
import type { EstimateVersionHistoryEntry } from "@/components/estimates/EstimateVersionHistory";
import type { WorkspaceJob, WorkspacePart } from "@/components/estimates/workspaceModel";
import { OverviewTab } from "@/components/work_orders/OverviewTab";
import { ServiceInfoTab } from "@/components/work_orders/ServiceInfoTab";
import { ContractSigningPanel } from "@/components/contracts/ContractSigningPanel";
import { SendMessagePanel } from "@/components/communications/SendMessagePanel";
import { SquareInvoicePanel } from "@/components/square/SquareInvoicePanel";
import { estimateTotalsWithHst } from "@/lib/pricing/hst";
import { JobsTab } from "@/components/jobs/JobsTab";
import { InspectionChecklist } from "@/components/inspections/InspectionChecklist";
import { RecommendationsTab } from "@/components/recommendations/RecommendationsTab";
import { PartsTab } from "@/components/parts/PartsTab";
import { PhotosTab } from "@/components/photos/PhotosTab";
import { TechnicianNotes } from "@/components/work_orders/TechnicianNotes";
import { TimelineList } from "@/components/timeline/TimelineList";
import { updateServiceInformationAction } from "@/app/(app)/motorcycles/actions";
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
  sendRecommendationEstimateAction,
  updateRecommendationStatusAction,
} from "@/app/(app)/work_orders/recommendation-actions";
import {
  addRecommendationToEstimateAction,
  confirmEstimateAction,
  presentEstimateAction,
} from "@/app/(app)/work_orders/estimate-actions";
import {
  addPartAction,
  updatePartPriceAction,
  updatePartStatusAction,
} from "@/app/(app)/work_orders/part-actions";
import {
  deleteIntakePhotoAction,
  uploadIntakePhotoAction,
} from "@/app/(app)/work_orders/photo-actions";
import { addTechnicianNoteAction } from "@/app/(app)/work_orders/note-actions";
import {
  cancelWorkOrderAction,
  clearAdminFlagAction,
  completeQualityCheckAction,
  completeWorkOrderAction,
  markReadyForPickupAction,
  placeWorkOrderOnHoldAction,
  resumeWorkOrderFromHoldAction,
} from "@/app/(app)/work_orders/quality-actions";
import { overrideSafetyRequirementAction } from "@/app/(app)/work_orders/safety-actions";
import {
  signDropOffAgreementAction,
  uploadPaperAgreementCopyAction,
} from "@/app/(app)/work_orders/contract-actions";
import type { IntakeFollowUp } from "@/lib/forms/intakeCompletion";
import { floorTechWorkOrderRedirect } from "@/lib/technician/assignmentHref";

export const dynamic = "force-dynamic";

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ work_order_id: string }>;
  searchParams: Promise<{
    tab?: string;
    from_result?: string;
    intake?: string;
    follow_up?: string;
  }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const { work_order_id } = await params;
  const {
    tab: tabParam,
    from_result: fromResultId,
    intake,
    follow_up: followUpParam,
  } = await searchParams;
  // Old ?tab=jobs / ?tab=recommendations bookmarks route to Estimate & Jobs.
  const activeTab: WorkOrderTabId = resolveWorkOrderTabId(tabParam);
  const intakeFollowUp: IntakeFollowUp | undefined =
    followUpParam === "signature" || followUpParam === "paper_copy"
      ? followUpParam
      : undefined;

  if (isFloorTech(user.role)) {
    redirect(floorTechWorkOrderRedirect(work_order_id, tabParam));
  }

  const detail = await getWorkOrderDetail(work_order_id).catch((error: unknown) => {
    if (error instanceof Error && error.message === "FORBIDDEN") {
      redirect(staffHomePath(user.role));
    }
    throw error;
  });
  if (!detail) notFound();

  const foreign = detail.is_foreign_location;
  const isEstimateTab = activeTab === "estimate";
  const needsTechs = !foreign && (activeTab === "overview" || isEstimateTab);
  const needsServices = !foreign && isEstimateTab;
  const needsInspection =
    activeTab === "overview" || activeTab === "inspection" || isEstimateTab;
  const needsParts = activeTab === "overview" || activeTab === "parts" || isEstimateTab;

  // The V2 workspace serves only when writes are enabled; legacy mode keeps
  // the old Jobs + Recommendations content (merged onto this tab) unchanged.
  const workflowFlags = readWorkflowV2Flags();
  const showV2Workspace =
    isEstimateTab && v2WritesEnabled(workflowFlags) && canViewPricing(user.role);

  const [
    photos,
    technicians,
    services,
    inspection,
    recommendations,
    outstandingRecommendations,
    recommendationEstimateLines,
    parts,
    notes,
    timeline,
    serviceInformation,
    agreement,
    agreementTemplate,
    communicationLogs,
    liveEstimate,
    estimateVersionRows,
  ] = await Promise.all([
    listIntakePhotos(work_order_id),
    needsTechs ? listTechniciansForActiveLocation() : Promise.resolve([]),
    needsServices ? listServices({ includeInactive: false }) : Promise.resolve([]),
    needsInspection ? getInspectionForWorkOrder(work_order_id) : Promise.resolve(null),
    isEstimateTab ? listRecommendationsForWorkOrder(work_order_id) : Promise.resolve([]),
    isEstimateTab
      ? listOutstandingRecommendationsForMotorcycle(detail.motorcycle_id, work_order_id)
      : Promise.resolve([]),
    isEstimateTab ? listRecommendationEstimateLines(work_order_id) : Promise.resolve([]),
    needsParts ? listPartsForWorkOrder(work_order_id) : Promise.resolve([]),
    activeTab === "notes" ? listTechnicianNotes(work_order_id) : Promise.resolve([]),
    activeTab === "timeline" ? listTimelineEvents(work_order_id) : Promise.resolve([]),
    activeTab === "service-info"
      ? getServiceInformation(detail.motorcycle_id)
      : Promise.resolve(null),
    activeTab === "contract" ? getDropOffAgreement(work_order_id) : Promise.resolve(null),
    activeTab === "contract" ? getActiveAgreementTemplate() : Promise.resolve(null),
    activeTab === "messages" ? listCommunicationLog(work_order_id) : Promise.resolve([]),
    showV2Workspace
      ? getLiveEstimateForWorkOrder(work_order_id).catch((error: unknown) => {
          console.warn("live estimate read skipped", error);
          return null as EstimateVersionView | null;
        })
      : Promise.resolve(null),
    showV2Workspace
      ? listEstimateVersionHistory(work_order_id).catch((error: unknown) => {
          console.warn("estimate history read skipped", error);
          return [];
        })
      : Promise.resolve([]),
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
  const canSeePartCost = canViewPartCost(user.role);
  const canSeePricing = canViewPricing(user.role);
  const canSeeClients = canViewClients(user.role);
  const canAdd = canCreateWorkOrder(user.role) || canEditWorkOrder(user.role);
  const canUploadPhotos =
    canEditWorkOrder(user.role) ||
    canCreateWorkOrder(user.role) ||
    isFloorTech(user.role);
  const canDeletePhotos = canDeleteIntakePhoto(user.role);
  const canAddNotes = canComplete || canEdit || canAdd;
  const canRunQc = canRunQualityCheck(user.role);
  const canClearFlags = canClearAdminFlag(user.role);
  const canOverrideSafety = canOverrideSafetyRequirement(user.role);
  const canMarkReady = canMarkReadyForPickup(user.role);
  const canCompleteWo = canCompleteWorkOrder(user.role);
  const canHoldOrCancel =
    canCompleteWorkOrder(user.role) || canOverrideWorkOrderStatus(user.role);
  const canResumeHold = canOverrideWorkOrderStatus(user.role);
  const canOverrideComplete = canOverrideWorkOrderStatus(user.role);
  const canEditServiceInfo =
    !detail.is_foreign_location && canUpdateServiceInformation(user.role);

  const merchandiseDollars =
    detail.jobs
      .filter((job) => job.status !== "cancelled" && job.status !== "declined")
      .reduce((sum, job) => sum + Number(job.standard_price_snapshot ?? 0), 0) +
    parts
      .filter((part) => part.status !== "cancelled" && part.status !== "not_required")
      .reduce(
        (sum, part) => sum + Number(part.unit_price ?? 0) * Number(part.quantity ?? 0),
        0
      );
  const {
    subtotalCents: estimateSubtotalCents,
    hstCents: estimateHstCents,
    totalCents: estimateTotalCents,
  } = estimateTotalsWithHst(merchandiseDollars);

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

  const workspaceJobs: WorkspaceJob[] = detail.jobs.map((job) => ({
    job_id: job.job_id,
    title: job.service_name_snapshot,
    status: job.status,
    standard_price_snapshot:
      job.standard_price_snapshot == null ? null : Number(job.standard_price_snapshot),
    assigned_technician_name: job.assigned_technician
      ? `${job.assigned_technician.first_name} ${job.assigned_technician.last_name}`
      : null,
  }));
  const workspaceParts: WorkspacePart[] = parts.map((part) => ({
    part_id: part.part_id,
    job_id: part.job_id,
    part_name: part.part_name,
    quantity: Number(part.quantity ?? 0),
    unit_price: part.unit_price == null ? null : Number(part.unit_price),
    status: part.status,
  }));
  const estimateVersionHistory: EstimateVersionHistoryEntry[] = (
    estimateVersionRows as Array<Record<string, unknown>>
  ).map((row) => ({
    estimate_version_id: String(row.estimate_version_id),
    version_no: Number(row.version_no),
    status: String(row.status),
    subtotal_cents: Number(row.subtotal_cents ?? 0),
    tax_cents: Number(row.tax_cents ?? 0),
    total_cents: Number(row.total_cents ?? 0),
    presented_at: (row.presented_at as string | null) ?? null,
    finalized_at: (row.finalized_at as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
  }));
  const openRecommendations = recommendations.filter(isRecommendationOpenForEstimate);

  const legacyJobsContent = (
    <JobsTab
      jobs={detail.jobs}
      services={services}
      technicians={technicians}
      readOnly={detail.is_foreign_location}
      canAdd={canAdd}
      canApprove={canApprove}
      canEdit={canEdit}
      canComplete={canComplete}
      canViewPricing={canSeePricing}
      currentUserId={user.user_id}
      inspectionComplete={Boolean(inspection?.completed_at)}
      inspectionHref={`/work_orders/${detail.work_order_id}/inspection`}
      addAction={addJobAction.bind(null, detail.work_order_id)}
      assignActionFor={assignJobTechnicianAction.bind(null, detail.work_order_id)}
      statusActionFor={updateJobStatusAction.bind(null, detail.work_order_id)}
      approveActionFor={approveJobAction.bind(null, detail.work_order_id)}
      declineActionFor={declineJobAction.bind(null, detail.work_order_id)}
      cancelActionFor={cancelJobAction.bind(null, detail.work_order_id)}
    />
  );

  const legacyRecommendationsContent = (
    <RecommendationsTab
      recommendations={recommendations}
      outstandingRecommendations={outstandingRecommendations}
      estimateLines={recommendationEstimateLines}
      services={services}
      readOnly={detail.is_foreign_location}
      canCreate={canRecommend}
      canUpdateStatus={canApprove || canRecommend}
      canConvert={canConvert}
      createAction={createRecommendationAction.bind(null, detail.work_order_id)}
      statusActionFor={updateRecommendationStatusAction.bind(null, detail.work_order_id)}
      convertActionFor={convertRecommendationAction.bind(null, detail.work_order_id)}
      sendEstimateAction={sendRecommendationEstimateAction.bind(
        null,
        detail.work_order_id
      )}
      fromResultId={fromResultId ?? null}
      fromResultDefaults={fromResultDefaults}
    />
  );

  return (
    <div className="page-stack page-stack--narrow">
      <Link
        href={isFloorTech(user.role) ? "/technician" : "/work_orders"}
        className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
      >
        {isFloorTech(user.role) ? "← Tech floor" : "← Work orders"}
      </Link>

      {intake === "complete" ? <IntakeCompleteNotice followUp={intakeFollowUp} /> : null}

      {detail.is_foreign_location ? (
        <div
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          This work order belongs to another location. You can view it for history, but
          switch location to make changes.
        </div>
      ) : null}

      <WorkOrderHeader
        detail={detail}
        photos={photos}
        canViewClients={canSeeClients}
        canViewPricing={canSeePricing}
        showContractAction={activeTab !== "overview"}
      />
      <WorkOrderTabs workOrderId={detail.work_order_id} activeTab={activeTab} />

      {activeTab === "overview" &&
      canSeeClients &&
      !detail.is_foreign_location &&
      detail.agreement_follow_up ? (
        <AgreementFollowUpNotice
          workOrderId={detail.work_order_id}
          followUp={detail.agreement_follow_up}
        />
      ) : null}

      {activeTab === "overview" ? (
        <>
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
            canClearFlags={canClearFlags}
            canOverrideSafety={canOverrideSafety}
            inspectionCompleted={Boolean(inspection?.completed_at)}
            readOnly={detail.is_foreign_location}
            assignAction={assignTechnicianAction.bind(null, detail.work_order_id)}
            setPrimaryAction={setPrimaryTechnicianAction.bind(null, detail.work_order_id)}
            qcAction={completeQualityCheckAction.bind(null, detail.work_order_id)}
            clearFlagAction={clearAdminFlagAction.bind(null, detail.work_order_id)}
            readyAction={markReadyForPickupAction.bind(null, detail.work_order_id)}
            completeAction={completeWorkOrderAction.bind(null, detail.work_order_id)}
            cancelAction={cancelWorkOrderAction.bind(null, detail.work_order_id)}
            holdAction={placeWorkOrderOnHoldAction.bind(null, detail.work_order_id)}
            resumeAction={resumeWorkOrderFromHoldAction.bind(null, detail.work_order_id)}
            safetyOverrideAction={overrideSafetyRequirementAction.bind(
              null,
              detail.work_order_id
            )}
          />
          {canSeePricing ? (
            <SquareInvoicePanel
              workOrderId={detail.work_order_id}
              squareInvoiceId={detail.square_invoice_id}
              squarePaymentStatus={detail.square_payment_status}
              squareInvoicePublicUrl={detail.square_invoice_public_url}
              billingStage={detail.billing_stage}
              billingCollectedCents={detail.billing_collected_cents}
              estimateSubtotalCents={estimateSubtotalCents}
              estimateHstCents={estimateHstCents}
              estimateTotalCents={estimateTotalCents}
              canManage={canApprove}
              readOnly={detail.is_foreign_location}
              customerPhone={detail.customer?.phone ?? null}
              customerEmail={detail.customer?.email ?? null}
              smsOptedOut={Boolean(detail.customer?.sms_opted_out_at)}
            />
          ) : null}
        </>
      ) : null}

      {activeTab === "estimate" ? (
        showV2Workspace ? (
          <div className="flex flex-col gap-4">
            <EstimateJobsWorkspace
              jobs={workspaceJobs}
              parts={workspaceParts}
              openRecommendations={openRecommendations}
              liveEstimate={liveEstimate}
              versionHistory={estimateVersionHistory}
              readOnly={detail.is_foreign_location}
              writesEnabled
              canPresent={canConvert}
              canConfirm={canApprove}
              presentAction={presentEstimateAction.bind(null, detail.work_order_id)}
              confirmAction={confirmEstimateAction.bind(null, detail.work_order_id)}
              addToEstimateActionFor={addRecommendationToEstimateAction.bind(
                null,
                detail.work_order_id
              )}
              recommendationStatusActionFor={updateRecommendationStatusAction.bind(
                null,
                detail.work_order_id
              )}
            />
            <details className="rounded border border-[var(--border)] bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--foreground)]">
                Job management (add, assign, start, complete)
              </summary>
              <div className="border-t border-[var(--border)] p-4">
                {legacyJobsContent}
              </div>
            </details>
            <details
              className="rounded border border-[var(--border)] bg-white"
              open={Boolean(fromResultId)}
            >
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--foreground)]">
                All advisories (legacy view)
              </summary>
              <div className="border-t border-[var(--border)] p-4">
                {legacyRecommendationsContent}
              </div>
            </details>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {legacyJobsContent}
            {legacyRecommendationsContent}
          </div>
        )
      ) : null}

      {activeTab === "inspection" ? (
        inspection ? (
          <div className="flex flex-col gap-3">
            <Link
              href={`/work_orders/${detail.work_order_id}/inspection`}
              className="btn btn-primary min-h-12 self-start"
            >
              Open inspection report
            </Link>
            {!inspection.completed_at ? (
              <p className="text-sm text-[var(--status-neutral)]">
                Jobs cannot be finished until this report is completed
                {inspection.missing_photos.length > 0
                  ? `, including ${inspection.missing_photos.length} required photo${
                      inspection.missing_photos.length === 1 ? "" : "s"
                    }`
                  : ""}
                .
              </p>
            ) : (
              <p className="text-sm font-medium text-emerald-800">
                Inspection report completed.
              </p>
            )}
            <InspectionChecklist
              inspection={inspection}
              canEdit={canInspect}
              canForceComplete={canForceInspect}
              canRecommend={canRecommend}
            />
          </div>
        ) : (
          <ComingSoonPanel title="Inspection" />
        )
      ) : null}

      {activeTab === "parts" ? (
        <PartsTab
          parts={parts}
          jobs={detail.jobs}
          readOnly={detail.is_foreign_location}
          canManage={canManageParts}
          canInstall={canComplete}
          canViewCost={canSeePartCost}
          canViewPricing={canSeePricing}
          addAction={addPartAction.bind(null, detail.work_order_id)}
          statusActionFor={updatePartStatusAction.bind(null, detail.work_order_id)}
          priceActionFor={updatePartPriceAction.bind(null, detail.work_order_id)}
        />
      ) : null}
      {activeTab === "photos" ? (
        <PhotosTab
          photos={photos}
          readOnly={detail.is_foreign_location}
          canUpload={canUploadPhotos}
          canDelete={canDeletePhotos}
          uploadAction={uploadIntakePhotoAction.bind(null, detail.work_order_id)}
          deleteAction={deleteIntakePhotoAction.bind(null, detail.work_order_id)}
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
        <ServiceInfoTab
          serviceInformation={serviceInformation}
          canEdit={canEditServiceInfo}
          action={updateServiceInformationAction.bind(
            null,
            detail.motorcycle_id,
            detail.work_order_id
          )}
        />
      ) : null}
      {activeTab === "contract" ? (
        agreementTemplate ? (
          <div className="flex flex-col gap-3">
            {!agreement && !detail.is_foreign_location ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3">
                <p className="flex-1 text-sm text-[var(--status-neutral-fg)]">
                  Drop-off agreement is unsigned. The signature is optional and can be
                  collected at any time.
                </p>
                <Link
                  href={`/work_orders/${detail.work_order_id}/contract`}
                  className="btn btn-primary min-h-11"
                >
                  Open signing screen
                </Link>
              </div>
            ) : (
              <Link
                href={`/work_orders/${detail.work_order_id}/contract`}
                className="btn btn-primary min-h-12 self-start"
              >
                Open iPad signing screen
              </Link>
            )}
            <ContractSigningPanel
              template={agreementTemplate}
              existing={agreement}
              readOnly={detail.is_foreign_location}
              action={signDropOffAgreementAction.bind(null, detail.work_order_id)}
              allowPaperSignature
              paperCopyAction={uploadPaperAgreementCopyAction.bind(
                null,
                detail.work_order_id
              )}
            />
          </div>
        ) : (
          <ComingSoonPanel title="Contract" />
        )
      ) : null}
      {activeTab === "messages" ? (
        <SendMessagePanel
          workOrderId={detail.work_order_id}
          logs={communicationLogs}
          canSend={canApprove}
          readOnly={detail.is_foreign_location}
          customerPhone={detail.customer?.phone ?? null}
          smsOptedOut={Boolean(detail.customer?.sms_opted_out_at)}
        />
      ) : null}
    </div>
  );
}
