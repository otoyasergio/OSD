"use client";

import { memo, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNowTick } from "@/lib/client/useNowTick";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Flag, Play } from "lucide-react";
import {
  dispatchWorkOrderToTechnicianAction,
  openWorkOrderAction,
  setStaffSignedInAction,
  unassignWorkOrderJobsAction,
} from "@/app/(app)/control-center/actions";
import { deriveTechAvailability } from "@/lib/control-center/availability";
import { moveWorkOrderOnBoardAction } from "@/app/(app)/work_orders/board-actions";
import { useDebouncedRouterRefresh } from "@/lib/client/useDebouncedRouterRefresh";
import { createClient } from "@/lib/database/supabase-browser";
import type { WorkOrderStatus } from "@/lib/database/types";
import { controlCenterCohortHref } from "@/lib/control-center/cohorts";
import {
  canDragCcBike,
  isCcStageDropEnabledForRole,
  isCcStageDropId,
  normalizeControlCenterDragId,
  resolveControlCenterDropTarget,
  stageDropIdForStatus,
  statusForCcStage,
  type CcStageDropId,
} from "@/lib/control-center/dnd";
import { formatElapsedTimer, timeInShopTone } from "@/lib/control-center/formatTimer";
import type {
  ControlCenterBike,
  ControlCenterData,
  ControlCenterTech,
} from "@/lib/services/controlCenter";
import type { ReadyForPickupItem, WaitingStageBike } from "@/lib/services/readyForPickup";
import { canDropInColumn } from "@/lib/status/transitions";
import {
  CompleteCarousel,
  ReadyForPickupCarousel,
  ReadyForQcCarousel,
  ReadyForSafetyInspectionCarousel,
  WaitingForPartsCarousel,
} from "@/components/technician/ReadyForPickupCarousel";
import { StageChip } from "@/components/ui/StageChip";
import { PageHeader } from "@/components/ui/PageHeader";

const POOL_ID = "pool";

const controlCenterCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0) return hits;
  return closestCenter(args);
};

function toStageBike(
  bike: ControlCenterBike | WaitingStageBike,
  stageId: CcStageDropId
): WaitingStageBike {
  if ("motorcycle_label" in bike && "ready_since" in bike) {
    const item = bike as WaitingStageBike;
    return {
      ...item,
      overview_href:
        stageId === "parts"
          ? `/work_orders/${item.work_order_id}?tab=parts`
          : `/work_orders/${item.work_order_id}`,
    };
  }
  const cc = bike as ControlCenterBike;
  return {
    work_order_id: cc.work_order_id,
    work_order_number: cc.work_order_number,
    motorcycle_label: cc.bike_title,
    ready_since: new Date().toISOString(),
    ready_since_inferred: true,
    primary_photo_url: cc.primary_photo_url,
    overview_href:
      stageId === "parts"
        ? `/work_orders/${cc.work_order_id}?tab=parts`
        : `/work_orders/${cc.work_order_id}`,
  };
}

function initials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function availabilityLabel(value: ControlCenterTech["availability"]) {
  if (value === "available") return "Available";
  if (value === "busy") return "Busy";
  return "Off shift";
}

function BikeMedia({ bike }: { bike: ControlCenterBike }) {
  const now = useNowTick(true);
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

const PoolBikeCard = memo(function PoolBikeCard({
  bike,
  dragging,
  canDrag,
  onOpenWork,
}: {
  bike: ControlCenterBike;
  dragging: boolean;
  canDrag: boolean;
  onOpenWork: (workOrderId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: bike.work_order_id,
    data: { workOrderId: bike.work_order_id },
    disabled: !canDrag,
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={[
        "cc-bike-card",
        bike.at_risk ? "cc-bike-card--risk" : "",
        isDragging || dragging ? "cc-bike-card--dragging" : "",
        !canDrag ? "cc-bike-card--static" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Open work order ${bike.work_order_number} for ${bike.bike_title}`}
      {...(canDrag ? { ...listeners, ...attributes } : {})}
      onClick={() => onOpenWork(bike.work_order_id)}
    >
      <BikeMedia bike={bike} />
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
});

function WorkElapsedLabel({ openedAt }: { openedAt: string }) {
  const now = useNowTick(true);
  const workElapsed = Math.max(0, now - new Date(openedAt).getTime());
  return <>{formatElapsedTimer(workElapsed)}</>;
}

const MiniBikeCard = memo(function MiniBikeCard({
  bike,
  canOpen,
  canDrag,
  onStartWork,
  onOpenWork,
  dragging,
}: {
  bike: ControlCenterBike;
  canOpen: boolean;
  canDrag: boolean;
  onStartWork: (workOrderId: string) => void;
  onOpenWork: (workOrderId: string) => void;
  dragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: bike.work_order_id,
    data: { workOrderId: bike.work_order_id },
    disabled: !canDrag,
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        "cc-mini-bike",
        isDragging || dragging ? "cc-mini-bike--dragging" : "",
        !canDrag ? "cc-mini-bike--static" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Open work order ${bike.work_order_number} for ${bike.bike_title}`}
      {...(canDrag ? { ...listeners, ...attributes } : {})}
      role="button"
      tabIndex={0}
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
          <WorkElapsedLabel openedAt={bike.opened_at} />
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
});

function TechOldestMeta({ bikes }: { bikes: ControlCenterBike[] }) {
  const now = useNowTick(bikes.length > 0);
  const oldestMs = bikes.reduce((max, bike) => {
    const ms = now - new Date(bike.date_created).getTime();
    return Math.max(max, ms);
  }, 0);
  return (
    <div className="cc-tech-meta">
      <span>
        {bikes.length} bike{bikes.length === 1 ? "" : "s"}
      </span>
      <span>oldest {bikes.length > 0 ? formatElapsedTimer(oldestMs) : "—"}</span>
    </div>
  );
}

const TechCard = memo(function TechCard({
  tech,
  canAssign,
  canClockStaff,
  clockPending,
  onToggleSignedIn,
  onStartWork,
  onOpenWork,
  activeId,
}: {
  tech: ControlCenterTech;
  canAssign: boolean;
  canClockStaff: boolean;
  clockPending: boolean;
  onToggleSignedIn: (techUserId: string, signedIn: boolean) => void;
  onStartWork: (workOrderId: string) => void;
  onOpenWork: (workOrderId: string) => void;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: tech.user_id,
    disabled: !canAssign,
  });
  const signedIn = tech.availability !== "off";

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
        <div className="cc-tech-identity">
          <p className="cc-tech-name">
            {tech.first_name} {tech.last_name}
          </p>
          <p className="cc-tech-role">
            {tech.role === "head_tech" ? "Head tech" : "Technician"}
          </p>
        </div>
        {canClockStaff ? (
          <label
            className={`cc-sign-in-toggle cc-sign-in-toggle--header${signedIn ? " is-on" : ""}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="cc-sign-in-toggle-label">
              {signedIn ? "Signed in" : "Signed out"}
            </span>
            <input
              type="checkbox"
              className="cc-sign-in-toggle-input"
              checked={signedIn}
              disabled={clockPending}
              aria-label={
                signedIn
                  ? `Sign out ${tech.first_name} ${tech.last_name}`
                  : `Sign in ${tech.first_name} ${tech.last_name}`
              }
              onChange={(event) => {
                onToggleSignedIn(tech.user_id, event.target.checked);
              }}
            />
            <span className="cc-sign-in-toggle-track" aria-hidden>
              <span className="cc-sign-in-toggle-thumb" />
            </span>
          </label>
        ) : (
          <span className={`cc-avail-pill cc-avail-pill--${tech.availability}`}>
            <span className="cc-avail-pill-dot" />
            {availabilityLabel(tech.availability)}
          </span>
        )}
      </div>
      <TechOldestMeta bikes={tech.assigned_bikes} />
      <div className="cc-tech-drop">
        {tech.assigned_bikes.length === 0 ? (
          <div className="cc-tech-empty">Drop a bike here</div>
        ) : (
          tech.assigned_bikes.map((bike) => (
            <MiniBikeCard
              key={bike.work_order_id}
              bike={bike}
              canOpen={canAssign}
              canDrag={canAssign}
              onStartWork={onStartWork}
              onOpenWork={onOpenWork}
              dragging={activeId === bike.work_order_id}
            />
          ))
        )}
      </div>
    </section>
  );
});

export function ControlCenterShell({
  data,
  canAssign,
  canClockStaff = false,
  waitingForParts = [],
  readyForQc = [],
  readyForSafety = [],
  readyForPickup = [],
  recentlyCompleted = [],
}: {
  data: ControlCenterData;
  canAssign: boolean;
  canClockStaff?: boolean;
  waitingForParts?: ReadyForPickupItem[];
  readyForQc?: ReadyForPickupItem[];
  readyForSafety?: ReadyForPickupItem[];
  readyForPickup?: ReadyForPickupItem[];
  recentlyCompleted?: ReadyForPickupItem[];
}) {
  const router = useRouter();
  const carouselRef = useRef<HTMLDivElement>(null);
  const suppressNextBikeClick = useRef(false);
  const [pool, setPool] = useState(data.pool);
  const [techs, setTechs] = useState(data.techs);
  const [kpis, setKpis] = useState(data.kpis);
  const [liveSummary, setLiveSummary] = useState(data.live_summary);
  const [partsQueue, setPartsQueue] = useState(waitingForParts);
  const [qcQueue, setQcQueue] = useState(readyForQc);
  const [safetyQueue, setSafetyQueue] = useState(readyForSafety);
  const [pickupQueue, setPickupQueue] = useState(readyForPickup);
  const [completeQueue, setCompleteQueue] = useState(recentlyCompleted);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const activeIdRef = useRef<string | null>(null);
  const isPendingRef = useRef(false);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    isPendingRef.current = isPending;
  }, [isPending]);
  const {
    schedule: scheduleRefresh,
    flush: flushRefresh,
    cancel: cancelRefresh,
  } = useDebouncedRouterRefresh({
    delayMs: 1500,
    // Pause while dragging or while a drop action is in flight so a stale
    // router.refresh cannot overwrite optimistic placement.
    isPaused: () => activeIdRef.current !== null || isPendingRef.current,
  });

  const syncKey = useMemo(
    () =>
      JSON.stringify({
        pool: data.pool.map(
          (b) => `${b.work_order_id}:${b.opened_at}:${b.technician_id}:${b.status}`
        ),
        techs: data.techs.map(
          (t) =>
            `${t.user_id}:${t.availability}:${t.assigned_bikes
              .map((b) => `${b.work_order_id}:${b.opened_at}:${b.status}`)
              .join(",")}`
        ),
        stages: {
          parts: waitingForParts.map((b) => b.work_order_id),
          qc: readyForQc.map((b) => b.work_order_id),
          safety: readyForSafety.map((b) => b.work_order_id),
          pickup: readyForPickup.map((b) => b.work_order_id),
          complete: recentlyCompleted.map((b) => b.work_order_id),
        },
        kpis: data.kpis,
        live: data.live_summary,
      }),
    [data, waitingForParts, readyForQc, readyForSafety, readyForPickup, recentlyCompleted]
  );
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  if (syncKey !== prevSyncKey) {
    setPrevSyncKey(syncKey);
    setPool(data.pool);
    setTechs(data.techs);
    setKpis(data.kpis);
    setLiveSummary(data.live_summary);
    setPartsQueue(waitingForParts);
    setQcQueue(readyForQc);
    setSafetyQueue(readyForSafety);
    setPickupQueue(readyForPickup);
    setCompleteQueue(recentlyCompleted);
  }

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`control-center:${data.location_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_order" },
        () => {
          scheduleRefresh();
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "job" }, () => {
        scheduleRefresh();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_clock_entry" },
        () => {
          scheduleRefresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data.location_id, scheduleRefresh]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const { setNodeRef: setPoolRef, isOver: poolOver } = useDroppable({
    id: POOL_ID,
    disabled: !canAssign,
  });

  const stageQueues = useMemo(
    () =>
      ({
        parts: partsQueue,
        qc: qcQueue,
        safety: safetyQueue,
        pickup: pickupQueue,
        complete: completeQueue,
      }) as Record<CcStageDropId, WaitingStageBike[]>,
    [partsQueue, qcQueue, safetyQueue, pickupQueue, completeQueue]
  );

  const allBikes = useMemo(() => {
    const map = new Map<string, ControlCenterBike>();
    for (const bike of pool) map.set(bike.work_order_id, bike);
    for (const tech of techs) {
      for (const bike of tech.assigned_bikes) map.set(bike.work_order_id, bike);
    }
    return map;
  }, [pool, techs]);

  const stageBikeMap = useMemo(() => {
    const map = new Map<string, WaitingStageBike>();
    for (const items of Object.values(stageQueues)) {
      for (const item of items) map.set(item.work_order_id, item);
    }
    return map;
  }, [stageQueues]);

  const activeWorkOrderId = activeId ? normalizeControlCenterDragId(activeId) : null;
  const activeBike = activeWorkOrderId ? (allBikes.get(activeWorkOrderId) ?? null) : null;
  const activeStageBike = activeWorkOrderId
    ? (stageBikeMap.get(activeWorkOrderId) ?? null)
    : null;

  function findAssignmentOwner(workOrderId: string): string | null {
    if (pool.some((b) => b.work_order_id === workOrderId)) return POOL_ID;
    for (const tech of techs) {
      if (tech.assigned_bikes.some((b) => b.work_order_id === workOrderId)) {
        return tech.user_id;
      }
    }
    return null;
  }

  function findStageOwner(workOrderId: string): CcStageDropId | null {
    for (const stageId of Object.keys(stageQueues) as CcStageDropId[]) {
      if (stageQueues[stageId].some((b) => b.work_order_id === workOrderId)) {
        return stageId;
      }
    }
    return null;
  }

  function containerForWorkOrder(workOrderId: string): string | null {
    return findAssignmentOwner(workOrderId) ?? findStageOwner(workOrderId);
  }

  function statusForWorkOrder(workOrderId: string): WorkOrderStatus | null {
    const bike = allBikes.get(workOrderId);
    if (bike) return bike.status;
    const stage = findStageOwner(workOrderId);
    return stage ? statusForCcStage(stage) : null;
  }

  function setStageQueue(stageId: CcStageDropId, items: WaitingStageBike[]) {
    if (stageId === "parts") setPartsQueue(items);
    else if (stageId === "qc") setQcQueue(items);
    else if (stageId === "safety") setSafetyQueue(items);
    else if (stageId === "pickup") setPickupQueue(items);
    else setCompleteQueue(items);
  }

  function applyOptimisticAssign(workOrderId: string, targetId: string) {
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

  function applyOptimisticStatusMove(workOrderId: string, stageId: CcStageDropId) {
    const nextStatus = statusForCcStage(stageId);
    const previous = {
      pool,
      techs,
      partsQueue,
      qcQueue,
      safetyQueue,
      pickupQueue,
      completeQueue,
    };

    const source = allBikes.get(workOrderId) ?? stageBikeMap.get(workOrderId) ?? null;
    if (!source) return null;

    if (stageId === "complete") {
      setPool((current) => current.filter((bike) => bike.work_order_id !== workOrderId));
      setTechs((current) =>
        current.map((tech) => ({
          ...tech,
          assigned_bikes: tech.assigned_bikes.filter(
            (bike) => bike.work_order_id !== workOrderId
          ),
        }))
      );
    } else {
      setPool((current) =>
        current.map((bike) =>
          bike.work_order_id === workOrderId ? { ...bike, status: nextStatus } : bike
        )
      );
      setTechs((current) =>
        current.map((tech) => ({
          ...tech,
          assigned_bikes: tech.assigned_bikes.map((bike) =>
            bike.work_order_id === workOrderId ? { ...bike, status: nextStatus } : bike
          ),
        }))
      );
    }

    const nextItem = toStageBike(source, stageId);
    for (const id of Object.keys(stageQueues) as CcStageDropId[]) {
      const filtered = stageQueues[id].filter((b) => b.work_order_id !== workOrderId);
      setStageQueue(id, id === stageId ? [nextItem, ...filtered] : filtered);
    }

    return previous;
  }

  function releaseSuppressBikeClick() {
    window.setTimeout(() => {
      suppressNextBikeClick.current = false;
    }, 50);
  }

  function handleDragStart(event: DragStartEvent) {
    suppressNextBikeClick.current = true;
    setErrorMessage(null);
    setActiveId(String(event.active.id));
  }

  function handleOpenWork(workOrderId: string, href?: string) {
    if (suppressNextBikeClick.current) {
      suppressNextBikeClick.current = false;
      return;
    }
    router.push(href ?? `/work_orders/${workOrderId}`);
  }

  function handleDragEnd(event: DragEndEvent) {
    activeIdRef.current = null;
    setActiveId(null);
    releaseSuppressBikeClick();
    const { active, over } = event;
    if (!over) {
      // No drop target — apply any realtime refresh deferred during the drag.
      flushRefresh();
      return;
    }

    const workOrderId = normalizeControlCenterDragId(String(active.id));
    const techIds = techs.map((t) => t.user_id);
    const targetId = resolveControlCenterDropTarget({
      overId: String(over.id),
      poolId: POOL_ID,
      techIds,
      containerForWorkOrder,
    });
    if (!targetId) {
      flushRefresh();
      return;
    }

    // Ignore drops that resolve back to the same dragged work order id.
    if (targetId === workOrderId) {
      flushRefresh();
      return;
    }

    const fromAssign = findAssignmentOwner(workOrderId);
    const fromStage = findStageOwner(workOrderId);
    const currentStatus = statusForWorkOrder(workOrderId);
    if (!currentStatus) {
      flushRefresh();
      return;
    }

    if (fromAssign && fromAssign === targetId) {
      flushRefresh();
      return;
    }
    if (fromStage && fromStage === targetId) {
      flushRefresh();
      return;
    }
    if (stageDropIdForStatus(currentStatus) === targetId) {
      flushRefresh();
      return;
    }

    if (isCcStageDropId(targetId)) {
      if (!canDropInColumn(data.role, targetId, currentStatus)) {
        setErrorMessage("You do not have permission to move this bike there.");
        flushRefresh();
        return;
      }

      // Dropping discards stale refreshes queued during drag; they would overwrite
      // optimistic placement with pre-drop server props (snap-back).
      cancelRefresh();
      const previous = applyOptimisticStatusMove(workOrderId, targetId);
      if (!previous) {
        flushRefresh();
        return;
      }

      startTransition(async () => {
        const result = await moveWorkOrderOnBoardAction(workOrderId, targetId);
        if (result.error) {
          setPool(previous.pool);
          setTechs(previous.techs);
          setPartsQueue(previous.partsQueue);
          setQcQueue(previous.qcQueue);
          setSafetyQueue(previous.safetyQueue);
          setPickupQueue(previous.pickupQueue);
          setCompleteQueue(previous.completeQueue);
          setErrorMessage(result.error);
        }
        scheduleRefresh();
      });
      return;
    }

    if (!canAssign) {
      setErrorMessage("You do not have permission to assign technicians.");
      flushRefresh();
      return;
    }
    if (!fromAssign && !allBikes.has(workOrderId)) {
      setErrorMessage("Open the work order to assign a technician.");
      flushRefresh();
      return;
    }

    cancelRefresh();
    const previous = applyOptimisticAssign(workOrderId, targetId);
    if (!previous) {
      flushRefresh();
      return;
    }

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
      scheduleRefresh();
    });
  }

  function handleToggleStaffSignedIn(techUserId: string, signedIn: boolean) {
    if (!canClockStaff) {
      setErrorMessage("You do not have permission to sign staff in or out.");
      return;
    }
    setErrorMessage(null);
    const previous = techs;
    setTechs((current) =>
      current.map((tech) => {
        if (tech.user_id !== techUserId) return tech;
        return {
          ...tech,
          availability: deriveTechAvailability({
            clockedIn: signedIn,
            activeAssignedJobCount: tech.assigned_bikes.length,
          }),
        };
      })
    );

    startTransition(async () => {
      const result = await setStaffSignedInAction(techUserId, signedIn);
      if (result.error) {
        setTechs(previous);
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

  const canDragStages = canDragCcBike(data.role, "in_progress", {
    mode: "stage",
    canAssign,
  });
  const stageDndBase = {
    dragEnabled: canDragStages,
    draggingId: activeId,
    onOpenWork: handleOpenWork,
  };

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
        {kpis.map((kpi) => {
          const valueClass = ["cc-kpi-value", kpi.danger ? "cc-kpi-value--danger" : ""]
            .filter(Boolean)
            .join(" ");

          if (!kpi.cohort) {
            return (
              <div key={kpi.label} className="stat-card">
                <span className="stat-card-label">{kpi.label}</span>
                <span className={valueClass}>{kpi.value}</span>
              </div>
            );
          }

          return (
            <Link
              key={kpi.label}
              href={controlCenterCohortHref(kpi.cohort)}
              className="stat-card cc-kpi-link"
              aria-label={`View ${kpi.label} bikes`}
            >
              <span className="stat-card-label">{kpi.label}</span>
              <span className={valueClass}>{kpi.value}</span>
            </Link>
          );
        })}
      </div>

      {errorMessage ? (
        <p className="cc-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={controlCenterCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          activeIdRef.current = null;
          setActiveId(null);
          flushRefresh();
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
              <h2 className="cc-pool-title">Waiting for tech</h2>
              <span className="shop-board-column-count">{pool.length}</span>
              <span className="cc-pool-caption">
                {canAssign
                  ? "Unassigned — drag onto a tech to dispatch"
                  : "Unassigned bikes (view only — you cannot assign)"}
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
                  canDrag={canAssign}
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
              canAssign={canAssign}
              canClockStaff={canClockStaff}
              clockPending={isPending}
              onToggleSignedIn={handleToggleStaffSignedIn}
              onStartWork={handleStartWork}
              onOpenWork={handleOpenWork}
              activeId={activeId}
            />
          ))}
        </div>

        <div className="cc-stage-queues">
          <WaitingForPartsCarousel
            items={partsQueue}
            dnd={{
              ...stageDndBase,
              droppableId: "parts",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "parts"),
            }}
          />
          <ReadyForQcCarousel
            items={qcQueue}
            dnd={{
              ...stageDndBase,
              droppableId: "qc",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "qc"),
            }}
          />
          <ReadyForSafetyInspectionCarousel
            items={safetyQueue}
            dnd={{
              ...stageDndBase,
              droppableId: "safety",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "safety"),
            }}
          />
          <ReadyForPickupCarousel
            items={pickupQueue}
            dnd={{
              ...stageDndBase,
              droppableId: "pickup",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "pickup"),
            }}
          />
          <CompleteCarousel
            items={completeQueue}
            dnd={{
              ...stageDndBase,
              dragEnabled: false,
              droppableId: "complete",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "complete"),
            }}
          />
        </div>

        <DragOverlay>
          {activeBike ? (
            <div className="cc-bike-card" style={{ width: "13.5rem" }}>
              <BikeMedia bike={activeBike} />
              <div className="cc-bike-body">
                <p className="cc-bike-title">{activeBike.bike_title}</p>
                <p className="cc-bike-subtitle">
                  {activeBike.customer_name} · {activeBike.work_order_number}
                </p>
              </div>
            </div>
          ) : activeStageBike ? (
            <div className="cc-bike-card" style={{ width: "13.5rem" }}>
              <div className="cc-bike-media">
                {activeStageBike.primary_photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
                  <img src={activeStageBike.primary_photo_url} alt="" />
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
              </div>
              <div className="cc-bike-body">
                <p className="cc-bike-title">{activeStageBike.motorcycle_label}</p>
                <p className="cc-bike-subtitle">{activeStageBike.work_order_number}</p>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
