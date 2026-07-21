import Link from "next/link";
import type { DocketItem } from "@/lib/services/technicianDocket";
import {
  docketCardAccessibleName,
  docketCardJobLine,
  docketCardToneClass,
  stampClass,
} from "@/lib/technician/docketCardDisplay";

function DocketJobLine({
  item,
}: {
  item: Pick<
    DocketItem,
    "subtitle" | "service_label" | "board_stamp" | "park_reason_label"
  >;
}) {
  const jobPart =
    item.board_stamp === "HOLD" && item.park_reason_label
      ? item.park_reason_label
      : item.service_label;

  return (
    <span className="pit-queue-sub">
      <span className="pit-queue-wo">{item.subtitle}</span>
      <span aria-hidden> · </span>
      {jobPart}
    </span>
  );
}

export function TechnicianDocketList({
  items,
  selectedKey,
  linkMode = "floor",
  reorderAction,
  variant = "pit",
}: {
  items: DocketItem[];
  selectedKey?: string | null;
  /** Floor deep-links use item.href; office overview uses overview_href as primary. */
  linkMode?: "floor" | "overview";
  /** When set, assigned job rows get advisor reorder controls (top/up/down). */
  reorderAction?: (formData: FormData) => Promise<void>;
  /** Pit Board flat line (default) or legacy bike cards. */
  variant?: "pit" | "legacy";
}) {
  if (items.length === 0) {
    return <p className="floor-muted">Nothing on this docket right now.</p>;
  }

  if (variant === "legacy") {
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
                aria-label={docketCardAccessibleName(item)}
                className={[
                  "floor-bike-card",
                  docketCardToneClass(item.board_stamp),
                  selected ? "floor-bike-card--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="floor-bike-card-top">
                  <span className="floor-docket-pos" aria-hidden>
                    {item.position}
                  </span>
                  <span className={stampClass(item.board_stamp)}>{item.board_stamp}</span>
                </div>
                <p className="floor-bike-card-bike">{item.motorcycle_label}</p>
                <p className="floor-bike-card-wo">
                  <span className="pit-queue-wo">{item.subtitle}</span>
                  <span aria-hidden> · </span>
                  {item.board_stamp === "HOLD" && item.park_reason_label
                    ? item.park_reason_label
                    : item.service_label}
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
                  >
                    Top
                  </button>
                  <button
                    type="submit"
                    name="dir"
                    value="up"
                    className="btn btn-secondary"
                  >
                    Up
                  </button>
                  <button
                    type="submit"
                    name="dir"
                    value="down"
                    className="btn btn-secondary"
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

  return (
    <ol className="pit-queue">
      {items.map((item) => {
        const href = linkMode === "overview" ? item.overview_href : item.href;
        const selected = selectedKey != null && item.key === selectedKey;
        const reorderable =
          reorderAction != null &&
          item.job_id != null &&
          (item.kind === "now" || item.kind === "assigned");
        return (
          <li key={item.key} className="pit-queue-item">
            <Link
              href={href}
              aria-label={docketCardAccessibleName(item)}
              className={[
                "pit-queue-card",
                docketCardToneClass(item.board_stamp),
                selected ? "pit-queue-card--selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="pit-queue-num" aria-hidden>
                {item.position}
              </span>
              <span className="pit-queue-body">
                <span className="pit-queue-bike">{item.motorcycle_label}</span>
                <DocketJobLine item={item} />
              </span>
              <span className={stampClass(item.board_stamp)}>{item.board_stamp}</span>
            </Link>
            {reorderable ? (
              <form action={reorderAction} className="floor-docket-reorder">
                <input type="hidden" name="job" value={item.job_id ?? ""} />
                <button
                  type="submit"
                  name="dir"
                  value="top"
                  className="btn btn-secondary"
                  aria-label={`Move ${docketCardJobLine(item)} to top`}
                >
                  Top
                </button>
                <button
                  type="submit"
                  name="dir"
                  value="up"
                  className="btn btn-secondary"
                  aria-label={`Move ${docketCardJobLine(item)} up`}
                >
                  Up
                </button>
                <button
                  type="submit"
                  name="dir"
                  value="down"
                  className="btn btn-secondary"
                  aria-label={`Move ${docketCardJobLine(item)} down`}
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
