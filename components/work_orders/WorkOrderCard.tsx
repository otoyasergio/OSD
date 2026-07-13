import { PhotoActionCard } from "@/components/ui/PhotoActionCard";
import type { WorkOrderStatus } from "@/lib/database/types";
import { getGalleryStageForStatus } from "@/lib/status/pipeline";

export type WorkOrderCardData = {
  work_order_id: string;
  work_order_number: string;
  external_invoice_number?: string | null;
  status: WorkOrderStatus;
  flags: string[];
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
    } | null;
  } | null;
  primary_technician?: {
    first_name: string;
    last_name: string;
  } | null;
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
  const customerName = customer
    ? `${customer.first_name} ${customer.last_name}`
    : "Unknown customer";
  const bikeLabel = bike ? `${bike.year} ${bike.make} ${bike.model}` : "No motorcycle";
  const stage = getGalleryStageForStatus(workOrder.status);
  const flagged = workOrder.flags.length > 0;

  return (
    <PhotoActionCard
      href={`/work_orders/${workOrder.work_order_id}`}
      photoUrl={workOrder.primary_photo_url}
      title={bikeLabel}
      subtitle={`${customerName} · ${workOrder.work_order_number}`}
      stageLabel={stage.label}
      stageTone={stage.tone}
      primaryLabel="Open"
      flagged={flagged}
      compact={compact}
    />
  );
}
