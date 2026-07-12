import type { WorkOrderStatus } from "@/lib/database/types";
import { SHOP_BOARD_COLUMNS } from "@/lib/status/pipeline";
import {
  WorkOrderCard,
  type WorkOrderCardData,
} from "@/components/work_orders/WorkOrderCard";

export function WorkOrderListView({
  rows,
  hideEmpty = false,
}: {
  rows: WorkOrderCardData[];
  hideEmpty?: boolean;
}) {
  const byStatus = new Map<WorkOrderStatus, WorkOrderCardData[]>();
  for (const row of rows) {
    const list = byStatus.get(row.status) ?? [];
    list.push(row);
    byStatus.set(row.status, list);
  }

  const sections = SHOP_BOARD_COLUMNS.map((column) => ({
    ...column,
    cards: column.statuses.flatMap((status) => byStatus.get(status) ?? []),
  })).filter((section) => !hideEmpty || section.cards.length > 0);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="wo-list-view">
      {sections.map((section) => (
        <section
          key={section.id}
          className="wo-list-section"
          aria-label={section.label}
        >
          <header className="wo-list-section-header">
            <h2 className="wo-list-section-title">{section.label}</h2>
            <span className="wo-list-section-count">{section.cards.length}</span>
          </header>
          <div className="wo-list-section-body">
            {section.cards.map((wo) => (
              <WorkOrderCard key={wo.work_order_id} workOrder={wo} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
