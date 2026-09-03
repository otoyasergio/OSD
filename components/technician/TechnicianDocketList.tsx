import Link from "next/link";
import {
  ArrowRight,
  Check,
  GripVertical,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { DocketItem } from "@/lib/services/technicianDocket";
import type { PitBoardStamp } from "@/lib/technician/pitBoard";
import { waitOwnerDisplayLabel } from "@/lib/technician/floorActionModel";
import {
  docketCardAccessibleName,
  docketCardJobLine,
  docketCardToneClass,
  isWaitingStamp,
  stampClass,
  stampDisplayLabel,
} from "@/lib/technician/docketCardDisplay";
import { canDragDocketItemToBench } from "@/lib/technician/benchDrag";
import { DraggableDocketCard } from "@/components/technician/DraggableDocketCard";

const STAMP_ICONS: Record<PitBoardStamp, LucideIcon> = {
  NOW: Play,
  NEXT: ArrowRight,
  NEW: Sparkles,
  HOLD: Pause,
  PAUSED: Pause,
  CHECK: ShieldCheck,
  DONE: Check,
};

function DocketStamp({ stamp }: { stamp: PitBoardStamp }) {
  const Icon = STAMP_ICONS[stamp];
  return (
    <span className={`${stampClass(stamp)} docket-stamp-icon`}>
      <Icon size={12} aria-hidden />
      {stampDisplayLabel(stamp)}
    </span>
  );
}

function DocketWaitLine({ item }: { item: DocketItem }) {
  if (!isWaitingStamp(item.board_stamp)) return null;
  const reason = item.wait_reason ?? item.park_reason_label ?? "Waiting";
  const owner = item.wait_owner_kind
    ? waitOwnerDisplayLabel(item.wait_owner_kind)
    : item.wait_owner_label || "Front desk";
  return (
    <span className="pit-queue-wait">
      {reason}
      <span aria-hidden> · </span>
      <span className="pit-queue-wait-owner">{owner}</span>
    </span>
  );
}

function DocketServiceLines({ item }: { item: DocketItem }) {
  const names = item.service_names.length > 0 ? item.service_names : [item.service_label];
  return (
    <span className="pit-queue-services">
      {names.map((name) => (
        <span key={name} className="pit-queue-service">
          {name}
        </span>
      ))}
    </span>
  );
}

export function TechnicianDocketList({
  items,
  selectedKey,
  linkMode = "floor",
  reorderAction,
  variant = "pit",
  dnd,
}: {
  items: DocketItem[];
  selectedKey?: string | null;
  /** Floor deep-links use item.href; office overview uses overview_href as primary. */
  linkMode?: "floor" | "overview";
  /** When set, assigned job rows get advisor reorder controls (top/up/down). */
  reorderAction?: (formData: FormData) => Promise<void>;
  /** Pit Board flat line (default) or legacy bike cards. */
  variant?: "pit" | "legacy";
  /** Drag bikes onto the workbench (tech floor). */
  dnd?: {
    enabled?: boolean;
    draggingKey?: string | null;
  };
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
                  <DocketStamp stamp={item.board_stamp} />
                </div>
                <p className="floor-bike-card-bike">{item.motorcycle_label}</p>
                <p className="floor-bike-card-wo">
                  <span className="pit-queue-wo">{item.subtitle}</span>
                  <span aria-hidden> · </span>
                  {isWaitingStamp(item.board_stamp) && item.park_reason_label
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
            <DraggableDocketCard
              item={item}
              dragEnabled={dnd?.enabled !== false}
              isDragging={dnd?.draggingKey === item.key}
            >
              <Link
                href={href}
                aria-label={docketCardAccessibleName(item)}
                className={[
                  "pit-queue-card",
                  docketCardToneClass(item.board_stamp),
                  selected ? "pit-queue-card--selected" : "",
                  canDragDocketItemToBench(item) ? "pit-queue-card--draggable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {canDragDocketItemToBench(item) ? (
                  <span className="pit-queue-grip" aria-hidden>
                    <GripVertical size={16} strokeWidth={2.25} />
                  </span>
                ) : null}
                <span className="pit-queue-num" aria-hidden>
                  {item.position}
                </span>
                <span className="pit-queue-body">
                  <span className="pit-queue-bike">
                    {item.motorcycle_label}
                    {item.awaiting_customer ? (
                      <span className="pit-queue-badge">Awaiting customer</span>
                    ) : null}
                  </span>
                  <span className="pit-queue-sub">
                    <span className="pit-queue-wo">{item.subtitle}</span>
                  </span>
                  <DocketServiceLines item={item} />
                  <DocketWaitLine item={item} />
                </span>
                <DocketStamp stamp={item.board_stamp} />
              </Link>
            </DraggableDocketCard>
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
