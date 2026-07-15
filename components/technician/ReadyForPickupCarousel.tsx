"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReadyForPickupItem } from "@/lib/services/readyForPickup";
import { formatElapsedTimer } from "@/lib/control-center/formatTimer";
import styles from "./ReadyForPickupCarousel.module.css";

const DAY_MS = 24 * 60 * 60 * 1000;
const PICKUP_YELLOW_MS = 1 * DAY_MS;
const PICKUP_RED_MS = 3 * DAY_MS;

function pickupTone(elapsedMs: number): "ok" | "warn" | "late" {
  if (elapsedMs >= PICKUP_RED_MS) return "late";
  if (elapsedMs >= PICKUP_YELLOW_MS) return "warn";
  return "ok";
}

function useNowTick(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

function PickupCard({ item, now }: { item: ReadyForPickupItem; now: number }) {
  const startMs = Date.parse(item.ready_since);
  const elapsed = !Number.isFinite(startMs) ? null : Math.max(0, now - startMs);
  const tone = elapsed == null ? "ok" : pickupTone(elapsed);
  const timerLabel = elapsed == null ? "—" : formatElapsedTimer(elapsed);

  return (
    <Link
      href={item.overview_href}
      className={[
        styles.card,
        tone === "warn" ? styles.cardWarn : "",
        tone === "late" ? styles.cardLate : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
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
          <span className="tabular-nums">{timerLabel}</span>
        </span>
      </div>
      <div className={styles.body}>
        <p className={styles.bike}>{item.motorcycle_label}</p>
        <p className={styles.wo}>{item.work_order_number}</p>
        <p className={styles.caption}>
          {item.ready_since_inferred ? "Waiting (approx)" : "Ready"}
          {elapsed == null ? "" : ` · ${formatElapsedTimer(elapsed)}`}
        </p>
      </div>
    </Link>
  );
}

export function ReadyForPickupCarousel({ items }: { items: ReadyForPickupItem[] }) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const now = useNowTick(items.length > 0);

  function scrollCarousel(direction: -1 | 1) {
    carouselRef.current?.scrollBy({ left: direction * 280, behavior: "smooth" });
  }

  if (items.length === 0) {
    return (
      <section className={styles.section} aria-label="Ready for pickup">
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>Ready for pickup</h2>
            <span className="shop-board-column-count">0</span>
          </div>
        </div>
        <div className={styles.empty}>No bikes waiting for pickup.</div>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-label="Ready for pickup">
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Ready for pickup</h2>
          <span className="shop-board-column-count">{items.length}</span>
          <span className={styles.subtitle}>Waiting on customer</span>
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
      <div ref={carouselRef} className={styles.carousel}>
        {items.map((item) => (
          <PickupCard key={item.work_order_id} item={item} now={now} />
        ))}
      </div>
    </section>
  );
}
