"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Flag, Play } from "lucide-react";
import {
  dispatchWorkOrderToTechnicianAction,
  openWorkOrderAction,
  unassignWorkOrderJobsAction,
} from "@/app/(app)/control-center/actions";
import { createClient } from "@/lib/database/supabase-browser";
import { formatElapsedTimer, timeInShopTone } from "@/lib/control-center/formatTimer";
import type {
  ControlCenterBike,
  ControlCenterData,
  ControlCenterTech,
} from "@/lib/services/controlCenter";
import { StageChip } from "@/components/ui/StageChip";
import { PageHeader } from "@/components/ui/PageHeader";

const POOL_ID = "pool";

function initials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function availabilityLabel(value: ControlCenterTech["availability"]) {
  if (value === "available") return "Available";
  if (value === "busy") return "Busy";
  return "Off shift";
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

function BikeMedia({ bike, now }: { bike: ControlCenterBike; now: number }) {
  const elapsed = Math.max(0, now - new Date(bike.date_created).getTime());
  const tone = timeInShopTone(elapsed);
  return (
    <div className="cc-bike-media">
      {bike.primary_photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
        <img src={bike.primary_photo_url} alt="" />
      ) : (
        <div className="cc-bike-placeholder" aria-hidden>
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
      <span className={`cc-status-dot cc-status-dot--${bike.status_dot}`} />
      <span className={`cc-time-pill cc-time-pill--${tone}`}>
        <span className="cc-time-pill-dot cc-pulse" />
        {formatElapsedTimer(elapsed)}
      </span>
    </div>
  );
}

function PoolBikeCard({
  bike,
  now,
  dragging,
  onOpenWork,
}: {
  bike: ControlCenterBike;
  now: number;
  dragging: boolean;
  onOpenWork: (workOrderId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: bike.work_order_id,
    data: { workOrderId: bike.work_order_id },
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={[
        "cc-bike-card",
        bike.at_risk ? "cc-bike-card--risk" : "",
        isDragging || dragging ? "cc-bike-card--dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Open work order ${bike.work_order_number} for ${bike.bike_title}`}
      {...listeners}
      {...attributes}
      onClick={() => onOpenWork(bike.work_order_id)}
    >
      <BikeMedia bike={bike} now={now} />
      <div className="cc-bike-body">
        <div className="cc-bike-title-row">
          <p className="cc-bike-title">{bike.bike_title}</p>
          <StageChip label={bike.stage_label} tone={bike.stage_tone} />
        </div>
        <p className="cc-bike-subtitle">
          {bike.customer_name} · {bike.work_order_number}
        </p>
        {bike.flag_badge ? (
          <span
            className={["cc-flag-badge", bike.at_risk ? "cc-flag-badge--risk" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <Flag size={11} strokeWidth={2.25} />
            {bike.flag_badge}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function MiniBikeCard({
  bike,
  now,
  canOpen,
  onStartWork,
  onOpenWork,
  dragging,
}: {
  bike: ControlCenterBike;
  now: number;
  canOpen: boolean;
  onStartWork: (workOrderId: string) => void;
  onOpenWork: (workOrderId: string) => void;
  dragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: bike.work_order_id,
    data: { workOrderId: bike.work_order_id },
  });
  const workElapsed = bike.opened_at
    ? Math.max(0, now - new Date(bike.opened_at).getTime())
    : 0;

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      className={["cc-mini-bike", isDragging || dragging ? "cc-mini-bike--dragging" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Open work order ${bike.work_order_number} for ${bike.bike_title}`}
      {...listeners}
      {...attributes}
      onClick={() => onOpenWork(bike.work_order_id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenWork(bike.work_order_id);
        }
      }}
    >
      <span className={`cc-mini-dot cc-mini-dot--${bike.status_dot}`} />
      <div className="cc-mini-main">
        <p className="cc-mini-title">{bike.bike_title}</p>
        <p className="cc-mini-sub">
          {bike.customer_name} · {bike.work_order_number}
        </p>
      </div>
      <StageChip label={bike.stage_label} tone={bike.stage_tone} />
      {bike.opened_at ? (
        <span className="cc-work-timer">
          <span className="cc-work-timer-dot cc-pulse" />
          {formatElapsedTimer(workElapsed)}
        </span>
      ) : (
        <button
          type="button"
          className="cc-open-btn"
          disabled={!canOpen}
          aria-label={`Start work timer for ${bike.work_order_number}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onStartWork(bike.work_order_id);
          }}
        >
          <Play size={11} strokeWidth={2.5} fill="currentColor" />
          Open
        </button>
      )}
    </div>
  );
}

function TechCard({
  tech,
  now,
  canAssign,
  onStartWork,
  onOpenWork,
  activeId,
}: {
  tech: ControlCenterTech;
  now: number;
  canAssign: boolean;
  onStartWork: (workOrderId: string) => void;
  onOpenWork: (workOrderId: string) => void;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: tech.user_id,
    disabled: !canAssign,
  });
  const oldestMs = tech.assigned_bikes.reduce((max, bike) => {
    const ms = now - new Date(bike.date_created).getTime();
    return Math.max(max, ms);
  }, 0);

  return (
    <section
      ref={setNodeRef}
      className={[
        "cc-tech-card",
        `cc-tech-card--${tech.availability}`,
        isOver && canAssign ? "cc-tech-card--over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="cc-tech-header">
        <div className="cc-tech-avatar">
          {initials(tech.first_name, tech.last_name)}
          <span className={`cc-tech-avail-dot cc-tech-avail-dot--${tech.availability}`} />
        </div>
        <div>
          <p className="cc-tech-name">
            {tech.first_name} {tech.last_name}
          </p>
          <p className="cc-tech-role">
            {tech.role === "head_tech" ? "Head tech" : "Technician"}
          </p>
        </div>
        <span className={`cc-avail-pill cc-avail-pill--${tech.availability}`}>
          <span className="cc-avail-pill-dot" />
          {availabilityLabel(tech.availability)}
        </span>
      </div>
      <div className="cc-tech-meta">
        <span>
          {tech.assigned_bikes.length} bike
          {tech.assigned_bikes.length === 1 ? "" : "s"}
        </span>
        <span>
          oldest {tech.assigned_bikes.length > 0 ? formatElapsedTimer(oldestMs) : "—"}
        </span>
      </div>
      <div className="cc-tech-drop">
        {tech.assigned_bikes.length === 0 ? (
          <div className="cc-tech-empty">Drop a bike here</div>
        ) : (
          tech.assigned_bikes.map((bike) => (
            <MiniBikeCard
              key={bike.work_order_id}
              bike={bike}
              now={now}
              canOpen={canAssign}
              onStartWork={onStartWork}
              onOpenWork={onOpenWork}
              dragging={activeId === bike.work_order_id}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function ControlCenterShell({
  data,
  canAssign,
}: {
  data: ControlCenterData;
  canAssign: boolean;
}) {
  const router = useRouter();
  const now = useNowTick(true);
  const carouselRef = useRef<HTMLDivElement>(null);
  const suppressNextBikeClick = useRef(false);
  const [pool, setPool] = useState(data.pool);
  const [techs, setTechs] = useState(data.techs);
  const [kpis, setKpis] = useState(data.kpis);
  const [liveSummary, setLiveSummary] = useState(data.live_summary);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const syncKey = useMemo(
    () =>
      JSON.stringify({
        pool: data.pool.map(
          (b) => `${b.work_order_id}:${b.opened_at}:${b.technician_id}`
        ),
        techs: data.techs.map(
          (t) =>
            `${t.user_id}:${t.availability}:${t.assigned_bikes
              .map((b) => `${b.work_order_id}:${b.opened_at}`)
              .join(",")}`
        ),
        kpis: data.kpis,
        live: data.live_summary,
      }),
    [data]
  );
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  if (syncKey !== prevSyncKey) {
    setPrevSyncKey(syncKey);
    setPool(data.pool);
    setTechs(data.techs);
    setKpis(data.kpis);
    setLiveSummary(data.live_summary);
  }

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`control-center:${data.location_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_order" },
        () => {
          router.refresh();
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "job" }, () => {
        router.refresh();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_clock_entry" },
        () => {
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data.location_id, router]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const { setNodeRef: setPoolRef, isOver: poolOver } = useDroppable({
    id: POOL_ID,
    disabled: !canAssign,
  });

  const allBikes = useMemo(() => {
    const map = new Map<string, ControlCenterBike>();
    for (const bike of pool) map.set(bike.work_order_id, bike);
    for (const tech of techs) {
      for (const bike of tech.assigned_bikes) map.set(bike.work_order_id, bike);
    }
    return map;
  }, [pool, techs]);

  const activeBike = activeId ? (allBikes.get(activeId) ?? null) : null;

  function findBikeOwner(workOrderId: string): string | null {
    if (pool.some((b) => b.work_order_id === workOrderId)) return POOL_ID;
    for (const tech of techs) {
      if (tech.assigned_bikes.some((b) => b.work_order_id === workOrderId)) {
        return tech.user_id;
      }
    }
    return null;
  }

  function applyOptimisticMove(workOrderId: string, targetId: string) {
    const bike = allBikes.get(workOrderId);
    if (!bike) return null;
    const previous = { pool, techs };
    const without = {
      pool: pool.filter((b) => b.work_order_id !== workOrderId),
      techs: techs.map((tech) => ({
        ...tech,
        assigned_bikes: tech.assigned_bikes.filter(
          (b) => b.work_order_id !== workOrderId
        ),
      })),
    };

    if (targetId === POOL_ID) {
      const moved = { ...bike, technician_id: null };
      setPool([moved, ...without.pool]);
      setTechs(without.techs);
    } else {
      const moved = { ...bike, technician_id: targetId };
      setPool(without.pool);
      setTechs(
        without.techs.map((tech) =>
          tech.user_id === targetId
            ? { ...tech, assigned_bikes: [...tech.assigned_bikes, moved] }
            : tech
        )
      );
    }
    return previous;
  }

  function releaseSuppressBikeClick() {
    // Clear after the post-drag click (if any) so the next real click still works.
    window.setTimeout(() => {
      suppressNextBikeClick.current = false;
    }, 50);
  }

  function handleDragStart(event: DragStartEvent) {
    suppressNextBikeClick.current = true;
    setErrorMessage(null);
    setActiveId(String(event.active.id));
  }

  function handleOpenWork(workOrderId: string) {
    if (suppressNextBikeClick.current) {
      suppressNextBikeClick.current = false;
      return;
    }
    router.push(`/work_orders/${workOrderId}`);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    releaseSuppressBikeClick();
    const { active, over } = event;
    if (!over || !canAssign) return;

    const workOrderId = String(active.id);
    const targetId = String(over.id);
    const fromId = findBikeOwner(workOrderId);
    if (!fromId || fromId === targetId) return;

    const previous = applyOptimisticMove(workOrderId, targetId);
    if (!previous) return;

    startTransition(async () => {
      const result =
        targetId === POOL_ID
          ? await unassignWorkOrderJobsAction(workOrderId)
          : await dispatchWorkOrderToTechnicianAction(workOrderId, targetId);
      if (result.error) {
        setPool(previous.pool);
        setTechs(previous.techs);
        setErrorMessage(result.error);
      }
    });
  }

  function handleStartWork(workOrderId: string) {
    setErrorMessage(null);
    const openedAt = new Date().toISOString();
    const previousPool = pool;
    const previousTechs = techs;
    setPool((current) =>
      current.map((bike) =>
        bike.work_order_id === workOrderId
          ? { ...bike, opened_at: bike.opened_at ?? openedAt }
          : bike
      )
    );
    setTechs((current) =>
      current.map((tech) => ({
        ...tech,
        assigned_bikes: tech.assigned_bikes.map((bike) =>
          bike.work_order_id === workOrderId
            ? { ...bike, opened_at: bike.opened_at ?? openedAt }
            : bike
        ),
      }))
    );

    startTransition(async () => {
      const result = await openWorkOrderAction(workOrderId);
      if (result.error) {
        setPool(previousPool);
        setTechs(previousTechs);
        setErrorMessage(result.error);
        return;
      }
      if (result.opened_at) {
        const confirmed = result.opened_at;
        setPool((current) =>
          current.map((bike) =>
            bike.work_order_id === workOrderId ? { ...bike, opened_at: confirmed } : bike
          )
        );
        setTechs((current) =>
          current.map((tech) => ({
            ...tech,
            assigned_bikes: tech.assigned_bikes.map((bike) =>
              bike.work_order_id === workOrderId
                ? { ...bike, opened_at: confirmed }
                : bike
            ),
          }))
        );
      }
    });
  }

  function scrollCarousel(direction: -1 | 1) {
    carouselRef.current?.scrollBy({ left: direction * 340, behavior: "smooth" });
  }

  return (
    <div className="page-stack page-stack--wide" style={{ gap: "1.25rem" }}>
      <PageHeader
        title="Control Center"
        subtitle={data.subtitle}
        actions={
          <div className="cc-live-pill">
            <span className="cc-live-dot cc-pulse" />
            <span className="cc-live-label">Live</span>
            <span style={{ opacity: 0.35 }}>·</span>
            <span className="cc-live-summary">
              {liveSummary}
              {isPending ? " · Saving…" : ""}
            </span>
          </div>
        }
      />

      <div className="cc-kpi-grid">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="stat-card">
            <span className="stat-card-label">{kpi.label}</span>
            <span
              className={["cc-kpi-value", kpi.danger ? "cc-kpi-value--danger" : ""]
                .filter(Boolean)
                .join(" ")}
            >
              {kpi.value}
            </span>
          </div>
        ))}
      </div>

      {errorMessage ? (
        <p className="cc-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          releaseSuppressBikeClick();
        }}
      >
        <section
          ref={setPoolRef}
          className={["cc-pool", poolOver && canAssign ? "cc-pool--over" : ""]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="cc-pool-header">
            <div className="cc-pool-title-row">
              <h2 className="cc-pool-title">Bikes in shop</h2>
              <span className="shop-board-column-count">{pool.length}</span>
              <span className="cc-pool-caption">
                Unassigned — drag onto a tech to dispatch
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button
                type="button"
                className="cc-scroll-btn"
                aria-label="Scroll left"
                onClick={() => scrollCarousel(-1)}
              >
                <ChevronLeft size={18} strokeWidth={2.25} />
              </button>
              <button
                type="button"
                className="cc-scroll-btn"
                aria-label="Scroll right"
                onClick={() => scrollCarousel(1)}
              >
                <ChevronRight size={18} strokeWidth={2.25} />
              </button>
            </div>
          </div>
          <div ref={carouselRef} className="cc-carousel">
            {pool.length === 0 ? (
              <div className="cc-pool-empty">
                All bikes are dispatched. Drag one back here to unassign.
              </div>
            ) : (
              pool.map((bike) => (
                <PoolBikeCard
                  key={bike.work_order_id}
                  bike={bike}
                  now={now}
                  dragging={activeId === bike.work_order_id}
                  onOpenWork={handleOpenWork}
                />
              ))
            )}
          </div>
        </section>

        <div className="cc-tech-grid">
          {techs.map((tech) => (
            <TechCard
              key={tech.user_id}
              tech={tech}
              now={now}
              canAssign={canAssign}
              onStartWork={handleStartWork}
              onOpenWork={handleOpenWork}
              activeId={activeId}
            />
          ))}
        </div>

        <DragOverlay>
          {activeBike ? (
            <div className="cc-bike-card" style={{ width: "13.5rem" }}>
              <BikeMedia bike={activeBike} now={now} />
              <div className="cc-bike-body">
                <p className="cc-bike-title">{activeBike.bike_title}</p>
                <p className="cc-bike-subtitle">
                  {activeBike.customer_name} · {activeBike.work_order_number}
                </p>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
