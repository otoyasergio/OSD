import Link from "next/link";
import type { DashboardRow } from "@/lib/services/dashboard";
import { buildDashboardBikeListItem } from "@/lib/status/pipeline";
import { EmptyState } from "@/components/ui/EmptyState";
import { StageChip } from "@/components/ui/StageChip";

export function DashboardCardBikesList({
  title,
  rows,
  backHref,
}: {
  title: string;
  rows: DashboardRow[];
  backHref: string;
}) {
  const items = rows.map((row) => buildDashboardBikeListItem(row));

  return (
    <section className="cc-cohort-list" aria-label={`${title} bikes`}>
      <div
        className="cc-cohort-list-header"
        style={{ justifyContent: "space-between", flexWrap: "wrap" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h2 className="cc-pool-title">{title}</h2>
          <span className="shop-board-column-count">{items.length}</span>
        </div>
        <Link href={backHref} className="btn btn-secondary">
          Back to board
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState
          variant="work-orders"
          title="No bikes in this list"
          description={`Nothing matches “${title}” right now.`}
          action={{ href: backHref, label: "Back to board" }}
        />
      ) : (
        <ul className="cc-cohort-rows">
          {items.map((item) => (
            <li key={item.workOrderId}>
              <Link href={item.href} className="cc-cohort-row">
                <div className="cc-cohort-row-main">
                  <p className="cc-bike-title">{item.bikeTitle}</p>
                  <p className="cc-bike-subtitle">{item.subtitle}</p>
                  <p
                    className="cc-bike-subtitle"
                    style={{ marginTop: "0.2rem", color: "var(--foreground)" }}
                  >
                    Next move: {item.nextMove}
                  </p>
                </div>
                <StageChip label={item.stageLabel} tone={item.stageTone} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
