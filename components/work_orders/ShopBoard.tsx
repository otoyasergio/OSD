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

  const columnCounts = SHOP_BOARD_COLUMNS.map((column) => ({
    id: column.id,
    count: column.statuses.reduce(
      (total, status) => total + (byStatus.get(status)?.length ?? 0),
      0
    ),
  }));
  const activeColumns = columnCounts.filter((column) => column.count > 0).length;

  return (
    <div className="shop-board-wrap">
      <p className="shop-board-summary" aria-live="polite">
        {rows.length === 0
          ? "No work orders on the board"
          : `${rows.length} work order${rows.length === 1 ? "" : "s"} across ${activeColumns} column${activeColumns === 1 ? "" : "s"}`}
      </p>
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
    </div>
  );
}
