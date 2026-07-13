import Link from "next/link";
import type { PartsWaitingItem } from "@/lib/services/partsBoard";
import { EmptyState } from "@/components/ui/EmptyState";

function daysLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function moneyLabel(value: number | null): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `$${Number(value).toFixed(2)}`;
}

function PartWaitingCard({ item }: { item: PartsWaitingItem }) {
  const price = moneyLabel(item.unit_price);

  return (
    <article className="td-board-card">
      <p className="td-board-card-title">{item.part_name}</p>
      <p className="td-board-card-sub">{item.customer_label}</p>
      <p className="td-board-card-sub">
        {item.job_name}
        {item.quantity > 1 ? ` · qty ${item.quantity}` : ""}
        {price ? ` · ${price}` : ""}
      </p>
      <p className="td-board-card-sub">{item.motorcycle_label}</p>
      {item.assigned_technician_label ? (
        <p className="td-board-card-sub">Tech: {item.assigned_technician_label}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={item.href} className="wo-card-number data-table-link">
          {item.work_order_number}
        </Link>
        <span className="stage-chip stage-chip--orange">
          {daysLabel(item.days_waiting)}
        </span>
      </div>
      {item.supplier || item.part_number || item.supplier_stock != null ? (
        <p className="td-board-card-sub">
          {[
            item.part_number,
            item.supplier,
            item.supplier_stock != null ? `PC stock ${item.supplier_stock}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      <div className="td-board-card-actions">
        <Link href={item.href} className="btn btn-primary">
          Open
        </Link>
      </div>
    </article>
  );
}

function Column({
  title,
  items,
  emptyDescription,
}: {
  title: string;
  items: PartsWaitingItem[];
  emptyDescription: string;
}) {
  return (
    <section className="shop-board-column" aria-label={title}>
      <header className="shop-board-column-header">
        <h2 className="shop-board-column-title">{title}</h2>
        <span className="shop-board-column-count">{items.length}</span>
      </header>
      <div className="shop-board-column-body flex flex-col gap-3">
        {items.length === 0 ? (
          <EmptyState description={emptyDescription} />
        ) : (
          items.map((item) => <PartWaitingCard key={item.part_id} item={item} />)
        )}
      </div>
    </section>
  );
}

export function PartsWaitingBoard({ items }: { items: PartsWaitingItem[] }) {
  const toOrder = items.filter((item) => item.bucket === "to_order");
  const inStock = items.filter((item) => item.bucket === "in_stock");
  const ordered = items.filter((item) => item.bucket === "ordered");

  if (items.length === 0) {
    return (
      <EmptyState
        title="No parts in the pipeline"
        description="After a job is approved, needed parts show under To order. In-stock and ordered parts appear in their own columns."
        action={{ href: "/work_orders", label: "View work orders" }}
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Column
        title="To order"
        items={toOrder}
        emptyDescription="No approved parts still need ordering."
      />
      <Column
        title="In stock"
        items={inStock}
        emptyDescription="No parts marked in stock on open work orders."
      />
      <Column
        title="Ordered"
        items={ordered}
        emptyDescription="No parts currently on order."
      />
    </div>
  );
}
