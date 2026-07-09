import Link from "next/link";
import type { PartsWaitingItem } from "@/lib/services/partsBoard";
import { EmptyState } from "@/components/ui/EmptyState";

function daysLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function PartWaitingCard({ item }: { item: PartsWaitingItem }) {
  return (
    <article className="card">
      <div className="card-body flex flex-col gap-2">
        <div className="wo-card-hero">
          <p className="wo-card-bike">{item.part_name}</p>
          <p className="wo-card-customer">{item.customer_label}</p>
        </div>
        <p className="wo-card-meta">
          {item.job_name}
          {item.quantity > 1 ? ` · qty ${item.quantity}` : ""}
        </p>
        <p className="wo-card-meta">{item.motorcycle_label}</p>
        {item.assigned_technician_label ? (
          <p className="wo-card-meta">Tech: {item.assigned_technician_label}</p>
        ) : null}
        <div className="wo-card-footer">
          <div className="wo-card-id-row">
            <Link href={item.href} className="wo-card-number data-table-link">
              {item.work_order_number}
            </Link>
            <span className="badge bg-[var(--status-waiting-bg)] text-[var(--status-waiting-fg)]">
              {daysLabel(item.days_waiting)}
            </span>
          </div>
          {item.supplier || item.part_number ? (
            <p className="wo-card-next-action">
              <span className="wo-card-next-label">
                {[item.part_number, item.supplier].filter(Boolean).join(" · ")}
              </span>
            </p>
          ) : null}
        </div>
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
          items.map((item) => (
            <PartWaitingCard key={item.part_id} item={item} />
          ))
        )}
      </div>
    </section>
  );
}

export function PartsWaitingBoard({ items }: { items: PartsWaitingItem[] }) {
  const needed = items.filter((item) => item.status === "needed");
  const ordered = items.filter((item) => item.status === "ordered");

  if (items.length === 0) {
    return (
      <EmptyState
        title="No parts waiting"
        description="Parts marked needed or ordered on open work orders will appear here."
        action={{ href: "/work_orders", label: "View work orders" }}
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Column
        title="Needed"
        items={needed}
        emptyDescription="No parts still marked as needed."
      />
      <Column
        title="Ordered"
        items={ordered}
        emptyDescription="No parts currently on order."
      />
    </div>
  );
}
