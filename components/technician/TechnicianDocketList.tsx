import Link from "next/link";
import type { DocketItem } from "@/lib/services/technicianDocket";

export function TechnicianDocketList({
  items,
  selectedKey,
  linkMode = "floor",
}: {
  items: DocketItem[];
  selectedKey?: string | null;
  /** Floor deep-links use item.href; office overview uses overview_href as primary. */
  linkMode?: "floor" | "overview";
}) {
  if (items.length === 0) {
    return <p className="floor-muted">Nothing on this docket right now.</p>;
  }

  return (
    <ol className="floor-docket-list">
      {items.map((item) => {
        const href = linkMode === "overview" ? item.overview_href : item.href;
        const selected = selectedKey != null && item.key === selectedKey;
        return (
          <li key={item.key}>
            <Link
              href={href}
              className={[
                "floor-queue-card floor-docket-card",
                selected ? "floor-queue-card--selected" : "",
                item.kind === "now" ? "floor-queue-card--now" : "",
                item.kind === "flag" ? "floor-queue-card--flagged" : "",
                item.kind === "qc" || item.kind === "safety"
                  ? "floor-queue-card--qc"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="floor-docket-pos" aria-hidden>
                {item.position}
              </span>
              <div className="floor-docket-body">
                <div className="floor-queue-card-title">{item.title}</div>
                <div className="floor-queue-card-meta">
                  {item.subtitle} · {item.status_label}
                  {item.kind === "now" ? " · NOW" : ""}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
