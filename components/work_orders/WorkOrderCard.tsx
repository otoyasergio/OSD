import { PhotoActionCard } from "@/components/ui/PhotoActionCard";
import { clientDisplayName } from "@/lib/customers/displayName";
import type { WorkOrderStatus } from "@/lib/database/types";
import type { IntakeFollowUp } from "@/lib/forms/intakeCompletion";
import { getAgreementFollowUpLabel } from "@/lib/status/agreementFollowUp";
import { getGalleryStageForStatus } from "@/lib/status/pipeline";
import { storageStayPresentation } from "@/lib/storage/terms";

export type WorkOrderCardData = {
  work_order_id: string;
  work_order_number: string;
  external_invoice_number?: string | null;
  status: WorkOrderStatus;
  flags: string[];
  agreement_follow_up?: IntakeFollowUp | null;
  primary_photo_url?: string | null;
  motorcycle: {
    year: number;
    make: string;
    model: string;
    vin?: string | null;
    customer: {
      first_name: string;
      last_name: string;
      phone?: string | null;
      email?: string | null;
      sms_opted_out_at?: string | null;
    } | null;
  } | null;
  primary_technician?: {
    first_name: string;
    last_name: string;
  } | null;
  storage_pickup_by?: string | null;
  storage_monthly_cents?: number | null;
};

export function WorkOrderCard({
  workOrder,
  compact = false,
  showPhoto: _showPhoto = true,
}: {
  workOrder: WorkOrderCardData;
  compact?: boolean;
  /** Kept for call-site compatibility; gallery cards always show photo frame. */
  showPhoto?: boolean;
}) {
  void _showPhoto;
  const customer = workOrder.motorcycle?.customer;
  const bike = workOrder.motorcycle;
  const bikeLabel = bike ? `${bike.year} ${bike.make} ${bike.model}` : "No motorcycle";
  const customerName = clientDisplayName(customer);
  const stage = getGalleryStageForStatus(workOrder.status);
  const flagged = workOrder.flags.length > 0;
  const agreementBadge = getAgreementFollowUpLabel(workOrder.agreement_follow_up);
  const storage =
    workOrder.status === "in_storage"
      ? storageStayPresentation(
          workOrder.storage_pickup_by,
          workOrder.storage_monthly_cents,
          new Date()
        )
      : null;

  return (
    <PhotoActionCard
      href={`/work_orders/${workOrder.work_order_id}`}
      photoUrl={workOrder.primary_photo_url}
      title={bikeLabel}
      customerName={customerName}
      subtitle={workOrder.work_order_number}
      stageLabel={stage.label}
      stageTone={stage.tone}
      primaryLabel="Open"
      badges={agreementBadge ? [agreementBadge] : []}
      flagged={flagged}
      compact={compact}
      storageTone={storage?.tone ?? null}
      storageNote={storage ? `${storage.remaining} · ${storage.detail}` : null}
    />
  );
}
