"use client";

import Link from "next/link";
import { useRef, useSyncExternalStore } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WaitingStageBike } from "@/lib/services/readyForPickup";
import { formatElapsedTimer } from "@/lib/control-center/formatTimer";
import styles from "./ReadyForPickupCarousel.module.css";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const PICKUP_YELLOW_MS = 1 * DAY_MS;
const PICKUP_RED_MS = 3 * DAY_MS;
const SAFETY_YELLOW_MS = 2 * HOUR_MS;
const SAFETY_RED_MS = 8 * HOUR_MS;

function waitTone(
  elapsedMs: number,
  warnAfterMs: number,
  lateAfterMs: number
): "ok" | "warn" | "late" {
  if (elapsedMs >= lateAfterMs) return "late";
  if (elapsedMs >= warnAfterMs) return "warn";
  return "ok";
}

function subscribeNowTick(onStoreChange: () => void) {
  const id = window.setInterval(onStoreChange, 1000);
  return () => window.clearInterval(id);
}

function getNowTick() {
  return Date.now();
}

function getServerNowTick() {
  return 0;
}

function useNowTick(enabled: boolean) {
  return useSyncExternalStore(
    enabled ? subscribeNowTick : () => () => {},
    enabled ? getNowTick : getServerNowTick,
    getServerNowTick
  );
}

export type WaitingBikeCarouselDnd = {
  droppableId: string;
  dropDisabled?: boolean;
  dragEnabled?: boolean;
  draggingId?: string | null;
  onOpenWork: (workOrderId: string, href: string) => void;
};

export type WaitingBikeCarouselProps = {
  items: WaitingStageBike[];
  title: string;
  /** Optional muted line next to the count badge. */
  subtitle?: string;
  emptyMessage: string;
  /** Caption when the stage stamp is present. */
  readyCaption?: string;
  /** Caption when waiting-since was inferred from updated_at. */
  approxCaption?: string;
  warnAfterMs?: number;
  lateAfterMs?: number;
  /** When set, section is a drop target and cards are draggable. */
  dnd?: WaitingBikeCarouselDnd;
};

function CardBody({
  item,
  now,
  readyCaption,
  approxCaption,
  warnAfterMs,
  lateAfterMs,
}: {
  item: WaitingStageBike;
  now: number;
  readyCaption: string;
  approxCaption: string;
  warnAfterMs: number;
  lateAfterMs: number;
}) {
  const startMs = Date.parse(item.ready_since);
  const elapsed = !Number.isFinite(startMs) ? null : Math.max(0, now - startMs);
  const tone = elapsed == null ? "ok" : waitTone(elapsed, warnAfterMs, lateAfterMs);
  const timerLabel = elapsed == null ? "—" : formatElapsedTimer(elapsed);

  return (
    <>
      <div className={styles.media}>
        {item.primary_photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
          <img src={item.primary_photo_url} alt="" />
        ) : (
          <div className={styles.placeholder} aria-hidden>
            <svg viewBox="0 0 48 32" width="40" height="26">
              <path
                d="M8 22c2-6 6-10 10-11 3 4 7 6 12 6 2 0 4-.4 6-1.2L40 22H8z"
                fill="currentColor"
                opacity="0.4"
              />
              <circle cx="16" cy="12" r="3" fill="currentColor" opacity="0.5" />
              <path d="M6 24h36v2H6z" fill="currentColor" opacity="0.3" />
            </svg>
          </div>
        )}
        <span
          className={[
            styles.timer,
            tone === "warn" ? styles.timerWarn : "",
            tone === "late" ? styles.timerLate : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className={styles.timerDot} aria-hidden />
          <span className="tabular-nums" suppressHydrationWarning>
            {timerLabel}
          </span>
        </span>
      </div>
      <div className={styles.body}>
        <p className={styles.bike}>{item.motorcycle_label}</p>
        <p className={styles.wo}>{item.work_order_number}</p>
        <p className={styles.caption}>
          {item.ready_since_inferred ? approxCaption : readyCaption}
          {elapsed == null ? "" : ` · ${formatElapsedTimer(elapsed)}`}
        </p>
      </div>
    </>
  );
}

function cardToneClass(
  item: WaitingStageBike,
  now: number,
  warnAfterMs: number,
  lateAfterMs: number
) {
  const startMs = Date.parse(item.ready_since);
  const elapsed = !Number.isFinite(startMs) ? null : Math.max(0, now - startMs);
  const tone = elapsed == null ? "ok" : waitTone(elapsed, warnAfterMs, lateAfterMs);
  return [
    styles.card,
    tone === "warn" ? styles.cardWarn : "",
    tone === "late" ? styles.cardLate : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function LinkBikeCard({
  item,
  now,
  readyCaption,
  approxCaption,
  warnAfterMs,
  lateAfterMs,
}: {
  item: WaitingStageBike;
  now: number;
  readyCaption: string;
  approxCaption: string;
  warnAfterMs: number;
  lateAfterMs: number;
}) {
  return (
    <Link
      href={item.overview_href}
      className={cardToneClass(item, now, warnAfterMs, lateAfterMs)}
    >
      <CardBody
        item={item}
        now={now}
        readyCaption={readyCaption}
        approxCaption={approxCaption}
        warnAfterMs={warnAfterMs}
        lateAfterMs={lateAfterMs}
      />
    </Link>
  );
}

function DraggableBikeCard({
  item,
  now,
  readyCaption,
  approxCaption,
  warnAfterMs,
  lateAfterMs,
  dragEnabled,
  dragging,
  onOpenWork,
}: {
  item: WaitingStageBike;
  now: number;
  readyCaption: string;
  approxCaption: string;
  warnAfterMs: number;
  lateAfterMs: number;
  dragEnabled: boolean;
  dragging: boolean;
  onOpenWork: (workOrderId: string, href: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `stage:${item.work_order_id}`,
    data: { workOrderId: item.work_order_id, source: "stage" },
    disabled: !dragEnabled,
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={[
        cardToneClass(item, now, warnAfterMs, lateAfterMs),
        styles.cardButton,
        isDragging || dragging ? styles.cardDragging : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Open work order ${item.work_order_number} for ${item.motorcycle_label}`}
      {...listeners}
      {...attributes}
      onClick={() => onOpenWork(item.work_order_id, item.overview_href)}
    >
      <CardBody
        item={item}
        now={now}
        readyCaption={readyCaption}
        approxCaption={approxCaption}
        warnAfterMs={warnAfterMs}
        lateAfterMs={lateAfterMs}
      />
    </button>
  );
}

export function WaitingBikeCarousel({
  items,
  title,
  subtitle,
  emptyMessage,
  readyCaption = "Ready",
  approxCaption = "Waiting (approx)",
  warnAfterMs = PICKUP_YELLOW_MS,
  lateAfterMs = PICKUP_RED_MS,
  dnd,
}: WaitingBikeCarouselProps) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const now = useNowTick(items.length > 0);
  const { setNodeRef, isOver } = useDroppable({
    id: dnd?.droppableId ?? `${title}-disabled-drop`,
    disabled: !dnd || Boolean(dnd.dropDisabled),
  });

  function scrollCarousel(direction: -1 | 1) {
    carouselRef.current?.scrollBy({ left: direction * 280, behavior: "smooth" });
  }

  const sectionClass = [
    styles.section,
    dnd && isOver && !dnd.dropDisabled ? styles.sectionOver : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      ref={dnd ? setNodeRef : undefined}
      className={sectionClass}
      aria-label={title}
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{title}</h2>
          <span className="shop-board-column-count">{items.length}</span>
          {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
        </div>
        {items.length > 2 ? (
          <div className={styles.scrollBtns}>
            <button
              type="button"
              className={styles.scrollBtn}
              aria-label="Scroll left"
              onClick={() => scrollCarousel(-1)}
            >
              <ChevronLeft size={18} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              className={styles.scrollBtn}
              aria-label="Scroll right"
              onClick={() => scrollCarousel(1)}
            >
              <ChevronRight size={18} strokeWidth={2.25} />
            </button>
          </div>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div className={styles.empty}>{emptyMessage}</div>
      ) : (
        <div ref={carouselRef} className={styles.carousel}>
          {items.map((item) =>
            dnd ? (
              <DraggableBikeCard
                key={item.work_order_id}
                item={item}
                now={now}
                readyCaption={readyCaption}
                approxCaption={approxCaption}
                warnAfterMs={warnAfterMs}
                lateAfterMs={lateAfterMs}
                dragEnabled={dnd.dragEnabled !== false}
                dragging={
                  dnd.draggingId === item.work_order_id ||
                  dnd.draggingId === `stage:${item.work_order_id}`
                }
                onOpenWork={dnd.onOpenWork}
              />
            ) : (
              <LinkBikeCard
                key={item.work_order_id}
                item={item}
                now={now}
                readyCaption={readyCaption}
                approxCaption={approxCaption}
                warnAfterMs={warnAfterMs}
                lateAfterMs={lateAfterMs}
              />
            )
          )}
        </div>
      )}
    </section>
  );
}

type StageCarouselProps = {
  items: WaitingStageBike[];
  dnd?: WaitingBikeCarouselDnd;
};

/** Tech-floor / CC pickup queue — thin wrapper over WaitingBikeCarousel. */
export function ReadyForPickupCarousel({ items, dnd }: StageCarouselProps) {
  return (
    <WaitingBikeCarousel
      items={items}
      title="Ready for pickup"
      subtitle={dnd ? "Drop to mark ready · waiting on customer" : "Waiting on customer"}
      emptyMessage="No bikes waiting for pickup."
      readyCaption="Ready"
      approxCaption="Waiting (approx)"
      warnAfterMs={PICKUP_YELLOW_MS}
      lateAfterMs={PICKUP_RED_MS}
      dnd={dnd}
    />
  );
}

/** Control Center — bikes in `waiting_for_parts` (above QC). */
export function WaitingForPartsCarousel({ items, dnd }: StageCarouselProps) {
  return (
    <WaitingBikeCarousel
      items={items}
      title="Waiting for parts"
      subtitle={dnd ? "Drop to set waiting for parts" : "Parts needed or on order"}
      emptyMessage="No bikes waiting for parts."
      readyCaption="Waiting"
      approxCaption="Waiting (approx)"
      warnAfterMs={PICKUP_YELLOW_MS}
      lateAfterMs={PICKUP_RED_MS}
      dnd={dnd}
    />
  );
}

/** Control Center — bikes in `quality_check` awaiting QC. */
export function ReadyForQcCarousel({ items, dnd }: StageCarouselProps) {
  return (
    <WaitingBikeCarousel
      items={items}
      title="QC"
      subtitle={dnd ? "Drop when jobs are complete" : "Waiting on quality check"}
      emptyMessage="No bikes waiting for QC."
      readyCaption="In queue"
      approxCaption="In queue (approx)"
      warnAfterMs={SAFETY_YELLOW_MS}
      lateAfterMs={SAFETY_RED_MS}
      dnd={dnd}
    />
  );
}

/** Control Center — bikes in `safety_check` awaiting inspection. */
export function ReadyForSafetyInspectionCarousel({ items, dnd }: StageCarouselProps) {
  return (
    <WaitingBikeCarousel
      items={items}
      title="Ready for safety"
      subtitle={dnd ? "Drop for head-tech safety check" : "Waiting on head tech"}
      emptyMessage="No bikes waiting for safety."
      readyCaption="In queue"
      approxCaption="In queue (approx)"
      warnAfterMs={SAFETY_YELLOW_MS}
      lateAfterMs={SAFETY_RED_MS}
      dnd={dnd}
    />
  );
}
