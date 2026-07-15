import Link from "next/link";
import type { DocketItem } from "@/lib/services/technicianDocket";

export function TechnicianDocketList({
  items,
  selectedKey,
  linkMode = "floor",
  reorderAction,
}: {
  items: DocketItem[];
  selectedKey?: string | null;
  /** Floor deep-links use item.href; office overview uses overview_href as primary. */
  linkMode?: "floor" | "overview";
  /** When set, assigned job rows get advisor reorder controls (top/up/down). */
  reorderAction?: (formData: FormData) => Promise<void>;
}) {
  if (items.length === 0) {
    return <p className="floor-muted">Nothing on this docket right now.</p>;
  }

  return (
    <ol className="floor-bike-card-grid floor-docket-list">
      {items.map((item) => {
        const href = linkMode === "overview" ? item.overview_href : item.href;
        const selected = selectedKey != null && item.key === selectedKey;
        const reorderable =
          reorderAction != null &&
          item.job_id != null &&
          (item.kind === "now" || item.kind === "assigned");
        return (
          <li key={item.key} className={reorderable ? "floor-docket-item" : undefined}>
            <Link
              href={href}
              className={[
                "floor-bike-card",
                selected ? "floor-bike-card--selected" : "",
                item.kind === "now" ? "floor-bike-card--now" : "",
                item.kind === "flag" ? "floor-bike-card--flagged" : "",
                item.kind === "qc" || item.kind === "safety" ? "floor-bike-card--qc" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="floor-bike-card-top">
                <span className="floor-docket-pos" aria-hidden>
                  {item.position}
                </span>
                {item.kind === "now" ? (
                  <span className="floor-now-badge">NOW</span>
                ) : null}
              </div>
              <p className="floor-bike-card-bike">{item.motorcycle_label}</p>
              <p className="floor-bike-card-wo">{item.subtitle}</p>
              <p className="floor-bike-card-meta">
                {item.service_label}
                <span aria-hidden> · </span>
                {item.status_label}
              </p>
            </Link>
            {reorderable ? (
              <form action={reorderAction} className="floor-docket-reorder">
                <input type="hidden" name="job" value={item.job_id ?? ""} />
                <button
                  type="submit"
                  name="dir"
                  value="top"
                  className="btn btn-secondary"
                  aria-label={`Move ${item.motorcycle_label} · ${item.service_label} to top`}
                >
                  Top
                </button>
                <button
                  type="submit"
                  name="dir"
                  value="up"
                  className="btn btn-secondary"
                  aria-label={`Move ${item.motorcycle_label} · ${item.service_label} up`}
                >
                  Up
                </button>
                <button
                  type="submit"
                  name="dir"
                  value="down"
                  className="btn btn-secondary"
                  aria-label={`Move ${item.motorcycle_label} · ${item.service_label} down`}
                >
                  Down
                </button>
              </form>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
