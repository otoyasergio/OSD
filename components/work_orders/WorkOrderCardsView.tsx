import {
  WorkOrderCard,
  type WorkOrderCardData,
} from "@/components/work_orders/WorkOrderCard";

export function WorkOrderCardsView({ rows }: { rows: WorkOrderCardData[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="wo-cards-view" aria-label="Work order cards">
      {rows.map((wo) => (
        <WorkOrderCard
          key={wo.work_order_id}
          workOrder={wo}
          showPhoto
        />
      ))}
    </div>
  );
}
