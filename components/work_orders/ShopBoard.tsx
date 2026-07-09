import type { WorkOrderStatus } from "@/lib/database/types";
import { SHOP_BOARD_COLUMNS } from "@/lib/status/pipeline";
import {
  WorkOrderCard,
  type WorkOrderCardData,
} from "@/components/work_orders/WorkOrderCard";

export function ShopBoard({ rows }: { rows: WorkOrderCardData[] }) {
  const byStatus = new Map<WorkOrderStatus, WorkOrderCardData[]>();
  for (const row of rows) {
    const list = byStatus.get(row.status) ?? [];
    list.push(row);
    byStatus.set(row.status, list);
  }

  return (
    <div className="shop-board">
      {SHOP_BOARD_COLUMNS.map((column) => {
        const cards = column.statuses.flatMap(
          (status) => byStatus.get(status) ?? []
        );

        return (
          <section
            key={column.id}
            className="shop-board-column"
            aria-label={column.label}
          >
            <header className="shop-board-column-header">
              <h2 className="shop-board-column-title">{column.label}</h2>
              <span className="shop-board-column-count">{cards.length}</span>
            </header>
            <div className="shop-board-column-body">
              {cards.length === 0 ? (
                <p className="shop-board-empty">No orders</p>
              ) : (
                cards.map((wo) => (
                  <WorkOrderCard key={wo.work_order_id} workOrder={wo} compact />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
