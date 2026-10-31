"use client";

import { memo, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNowTick } from "@/lib/client/useNowTick";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  pointerWithin,
  useDraggable,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useBoardDragSensors } from "@/lib/client/useBoardDragSensors";
import { ChevronDown, ChevronLeft, ChevronRight, Flag, Play } from "lucide-react";
import {
  dispatchWorkOrderToTechnicianAction,
  openWorkOrderAction,
  setStaffSignedInAction,
  unassignWorkOrderJobsAction,
} from "@/app/(app)/control-center/actions";
import { deriveTechAvailability } from "@/lib/control-center/availability";
import { moveWorkOrderOnBoardAction } from "@/app/(app)/work_orders/board-actions";
import { PickupNoticeDialog } from "@/components/communications/PickupNoticeDialog";
import {
  pickupNoticeFromBoardBike,
  shouldPromptPickupNotice,
  type PickupNoticeContact,
} from "@/lib/communications/pickupNotice";
import { canParkAnyBikeInStorage, canRearrangeControlCenter } from "@/lib/permissions";
import { useDebouncedRouterRefresh } from "@/lib/client/useDebouncedRouterRefresh";
import { createClient } from "@/lib/database/supabase-browser";
import type { WorkOrderStatus } from "@/lib/database/types";
import { useCollapsedSection } from "@/lib/control-center/collapsedSections";
import { controlCenterCohortHref } from "@/lib/control-center/cohorts";
import {
  canAutoScrollControlCenter,
  collectControlCenterWorkOrderIds,
  reconcilePendingControlCenterMoves,
  shouldDeferControlCenterServerSnapshot,
  workOrderIdFromJobRealtimePayload,
  type ControlCenterPendingMove,
} from "@/lib/control-center/boardSync";
import {
  allowsControlCenterDrop,
  assignBoardColumnForTarget,
  canDragCcBike,
  isCcStageDropEnabledForRole,
  isCcStageDropId,
  isControlCenterDispatchStatus,
  normalizeControlCenterDragId,
  removeWorkOrderFromControlCenterLists,
  resolveControlCenterDropTarget,
  stageDropIdForStatus,
  statusForCcStage,
  type CcStageDropId,
} from "@/lib/control-center/dnd";
import {
  calculateAverageDaysInShop,
  formatElapsedTimer,
  timeInShopTone,
} from "@/lib/control-center/formatTimer";
import type {
  ControlCenterBike,
  ControlCenterData,
  ControlCenterTech,
} from "@/lib/services/controlCenter";
import type { ReadyForPickupItem, WaitingStageBike } from "@/lib/services/readyForPickup";
import { getGalleryStageForStatus } from "@/lib/status/pipeline";
import {
  CompleteCarousel,
  InsuranceBikesCarousel,
  ReadyForPickupCarousel,
  StorageCarousel,
  ReadyForQcCarousel,
  ReadyForSafetyInspectionCarousel,
  WaitingForApprovalCarousel,
  WaitingForPartsCarousel,
} from "@/components/technician/ReadyForPickupCarousel";
import { StageChip } from "@/components/ui/StageChip";
import { PageHeader } from "@/components/ui/PageHeader";

const POOL_ID = "pool";

/**
 * Pointer-only, same as the tech floor. closestCenter snaps to the source
 * lane when the overlay lags — Complete is the longest drag, so that looks
 * like the card jumping back.
 */
const controlCenterCollision: CollisionDetection = (args) => pointerWithin(args);

type CcPendingMove = ControlCenterPendingMove<ControlCenterBike, WaitingStageBike>;

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
    customer_name: cc.customer_name,
    customer_phone: cc.customer_phone,
    customer_email: cc.customer_email,
    customer_sms_opted_out: cc.customer_sms_opted_out,
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
        <img src={bike.primary_photo_url} alt="" draggable={false} />
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
  canReceiveDrops = canAssign,
  canDragBikes = canAssign,
  canClockStaff,
  clockPending,
  onToggleSignedIn,
  onStartWork,
  onOpenWork,
  activeId,
}: {
  tech: ControlCenterTech;
  canAssign: boolean;
  canReceiveDrops?: boolean;
  canDragBikes?: boolean;
  canClockStaff: boolean;
  clockPending: boolean;
  onToggleSignedIn: (techUserId: string, signedIn: boolean) => void;
  onStartWork: (workOrderId: string) => void;
  onOpenWork: (workOrderId: string) => void;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: tech.user_id,
    disabled: !canReceiveDrops,
  });
  const signedIn = tech.availability !== "off";
  const { collapsed, toggle } = useCollapsedSection(`tech:${tech.user_id}`);
  const techName = `${tech.first_name} ${tech.last_name}`;

  return (
    <section
      ref={setNodeRef}
      className={[
        "cc-tech-card",
        `cc-tech-card--${tech.availability}`,
        collapsed ? "cc-tech-card--collapsed" : "",
        isOver && canReceiveDrops ? "cc-tech-card--over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="cc-tech-header">
        <button
          type="button"
          className="cc-collapse-toggle"
          aria-expanded={!collapsed}
          aria-controls={`cc-section-tech-${tech.user_id}`}
          onClick={toggle}
        >
          <ChevronDown
            size={18}
            strokeWidth={2.25}
            aria-hidden
            className={
              collapsed
                ? "cc-collapse-chevron cc-collapse-chevron--collapsed"
                : "cc-collapse-chevron"
            }
          />
          <span className="cc-tech-avatar">
            {initials(tech.first_name, tech.last_name)}
            <span
              className={`cc-tech-avail-dot cc-tech-avail-dot--${tech.availability}`}
            />
          </span>
          <span className="cc-tech-identity">
            <span className="cc-tech-name">{techName}</span>
            <span className="cc-tech-role">
              {tech.role === "head_tech" ? "Head tech" : "Technician"}
            </span>
          </span>
        </button>
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
      {collapsed ? null : (
        <div id={`cc-section-tech-${tech.user_id}`} className="cc-tech-drop">
          {tech.assigned_bikes.length === 0 ? (
            <div className="cc-tech-empty">Drop a bike here</div>
          ) : (
            tech.assigned_bikes.map((bike) => (
              <MiniBikeCard
                key={bike.work_order_id}
                bike={bike}
                canOpen={canAssign}
                canDrag={canDragBikes}
                onStartWork={onStartWork}
                onOpenWork={onOpenWork}
                dragging={activeId === bike.work_order_id}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
});

export function ControlCenterShell({
  data,
  canAssign,
  canClockStaff = false,
  waitingForApproval = [],
  waitingForParts = [],
  readyForQc = [],
  readyForSafety = [],
  readyForPickup = [],
  inStorage = [],
  recentlyCompleted = [],
  insuranceBikes = [],
}: {
  data: ControlCenterData;
  canAssign: boolean;
  canClockStaff?: boolean;
  waitingForApproval?: ReadyForPickupItem[];
  waitingForParts?: ReadyForPickupItem[];
  readyForQc?: ReadyForPickupItem[];
  readyForSafety?: ReadyForPickupItem[];
  readyForPickup?: ReadyForPickupItem[];
  inStorage?: ReadyForPickupItem[];
  recentlyCompleted?: ReadyForPickupItem[];
  insuranceBikes?: ReadyForPickupItem[];
}) {
  const router = useRouter();
  const carouselRef = useRef<HTMLDivElement>(null);
  const suppressNextBikeClick = useRef(false);
  const [pool, setPool] = useState(data.pool);
  const [techs, setTechs] = useState(data.techs);
  const [kpis, setKpis] = useState(data.kpis);
  const [liveSummary, setLiveSummary] = useState(data.live_summary);
  const [approvalQueue, setApprovalQueue] = useState(waitingForApproval);
  const [partsQueue, setPartsQueue] = useState(waitingForParts);
  const [qcQueue, setQcQueue] = useState(readyForQc);
  const [safetyQueue, setSafetyQueue] = useState(readyForSafety);
  const [pickupQueue, setPickupQueue] = useState(readyForPickup);
  const [storageQueue, setStorageQueue] = useState(inStorage);
  const [completeQueue, setCompleteQueue] = useState(recentlyCompleted);
  const [insuranceQueue, setInsuranceQueue] = useState(insuranceBikes);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pickupNotice, setPickupNotice] = useState<PickupNoticeContact | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingMoves, setPendingMoves] = useState<CcPendingMove[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const knownWorkOrderIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  const {
    schedule: scheduleRefresh,
    flush: flushRefresh,
    cancel: cancelRefresh,
  } = useDebouncedRouterRefresh({
    delayMs: 1500,
    // Pause while dragging so a flush cannot remount droppables mid-gesture.
    // In-flight refreshes still apply via props; pendingMoves overlays those.
    isPaused: () => activeIdRef.current !== null,
  });

  function withDerivedTechAvailability(
    nextTechs: ControlCenterTech[]
  ): ControlCenterTech[] {
    return nextTechs.map((tech) => {
      const activeAssignedJobCount = tech.assigned_bikes.filter((bike) =>
        isControlCenterDispatchStatus(bike.status)
      ).length;
      return {
        ...tech,
        availability: deriveTechAvailability({
          clockedIn: tech.availability !== "off",
          activeAssignedJobCount,
        }),
      };
    });
  }

  const dateCreatedByWo = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of data.bikes ?? []) map.set(b.work_order_id, b.date_created);
    for (const b of data.pool) map.set(b.work_order_id, b.date_created);
    for (const t of data.techs) {
      for (const b of t.assigned_bikes) map.set(b.work_order_id, b.date_created);
    }
    return map;
  }, [data.bikes, data.pool, data.techs]);

  function deriveOptimisticSummaryAndKpis(input: {
    pool: ControlCenterBike[];
    techs: ControlCenterTech[];
    stages: Record<CcStageDropId, WaitingStageBike[]>;
    baseKpis: ControlCenterData["kpis"];
    completedDelta?: number;
  }) {
    const dispatchPool = input.pool.filter((b) =>
      isControlCenterDispatchStatus(b.status)
    );
    const dispatchTechBikes = input.techs.flatMap((t) =>
      t.assigned_bikes.filter((b) => isControlCenterDispatchStatus(b.status))
    );
    const activeBikeCount =
      dispatchPool.length +
      dispatchTechBikes.length +
      input.stages.approval.length +
      input.stages.parts.length +
      input.stages.qc.length +
      input.stages.safety.length +
      input.stages.pickup.length +
      input.stages.storage.length +
      input.stages.insurance.length;
    const availableCount = input.techs.filter(
      (t) => t.availability === "available"
    ).length;
    const inBayCount = [...dispatchPool, ...dispatchTechBikes].filter(
      (b) => b.status === "in_progress"
    ).length;
    const waitingApprovalCount = input.stages.approval.length;
    const avgDays = calculateAverageDaysInShop([
      ...dispatchPool.map((b) => ({ status: b.status, date_created: b.date_created })),
      ...dispatchTechBikes.map((b) => ({
        status: b.status,
        date_created: b.date_created,
      })),
      ...input.stages.approval.map((b) => ({
        status: "waiting_for_customer_approval",
        date_created: dateCreatedByWo.get(b.work_order_id) ?? b.ready_since,
      })),
      ...input.stages.parts.map((b) => ({
        status: "waiting_for_parts",
        date_created: dateCreatedByWo.get(b.work_order_id) ?? b.ready_since,
      })),
      ...input.stages.qc.map((b) => ({
        status: "quality_check",
        date_created: dateCreatedByWo.get(b.work_order_id) ?? b.ready_since,
      })),
      ...input.stages.safety.map((b) => ({
        status: "safety_check",
        date_created: dateCreatedByWo.get(b.work_order_id) ?? b.ready_since,
      })),
      ...input.stages.pickup.map((b) => ({
        status: "ready_for_pickup",
        date_created: dateCreatedByWo.get(b.work_order_id) ?? b.ready_since,
      })),
    ]);
    const completedDelta = input.completedDelta ?? 0;

    const nextKpis = input.baseKpis.map((kpi) => {
      if (kpi.label === "In shop now" || kpi.label === "In shop") {
        return { ...kpi, value: String(activeBikeCount) };
      }
      if (kpi.label === "Avg days in shop") {
        return { ...kpi, value: avgDays == null ? "—" : String(avgDays) };
      }
      if (kpi.label === "In bay") {
        return { ...kpi, value: String(inBayCount) };
      }
      if (kpi.label === "Unassigned") {
        return { ...kpi, value: String(dispatchPool.length) };
      }
      if (kpi.label === "Techs available") {
        return { ...kpi, value: `${availableCount}/${input.techs.length}` };
      }
      if (kpi.label === "Ready for pickup") {
        return { ...kpi, value: String(input.stages.pickup.length) };
      }
      if (kpi.label === "Waiting approval") {
        return { ...kpi, value: String(waitingApprovalCount) };
      }
      if (kpi.label === "Completed today" && completedDelta !== 0) {
        const current = Number.parseInt(kpi.value, 10);
        if (Number.isFinite(current)) {
          return { ...kpi, value: String(Math.max(0, current + completedDelta)) };
        }
      }
      return kpi;
    });

    return {
      kpis: nextKpis,
      liveSummary: `${activeBikeCount} bikes · ${availableCount}/${input.techs.length} techs`,
    };
  }

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
          approval: waitingForApproval.map((b) => b.work_order_id),
          parts: waitingForParts.map((b) => b.work_order_id),
          qc: readyForQc.map((b) => b.work_order_id),
          safety: readyForSafety.map((b) => b.work_order_id),
          pickup: readyForPickup.map((b) => b.work_order_id),
          storage: inStorage.map((b) => b.work_order_id),
          complete: recentlyCompleted.map((b) => b.work_order_id),
          insurance: insuranceBikes.map((b) => b.work_order_id),
        },
        kpis: data.kpis,
        live: data.live_summary,
      }),
    [
      data,
      waitingForApproval,
      waitingForParts,
      readyForQc,
      readyForSafety,
      readyForPickup,
      inStorage,
      recentlyCompleted,
      insuranceBikes,
    ]
  );
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  if (
    syncKey !== prevSyncKey &&
    !shouldDeferControlCenterServerSnapshot(activeId !== null)
  ) {
    setPrevSyncKey(syncKey);
    const snapshot = {
      pool: data.pool,
      techs: data.techs,
      stages: {
        approval: waitingForApproval,
        parts: waitingForParts,
        qc: readyForQc,
        safety: readyForSafety,
        pickup: readyForPickup,
        storage: inStorage,
        complete: recentlyCompleted,
        insurance: insuranceBikes,
      } as Record<CcStageDropId, WaitingStageBike[]>,
    };
    const reconciled =
      pendingMoves.length > 0
        ? reconcilePendingControlCenterMoves({
            pendingMoves,
            ...snapshot,
            poolId: POOL_ID,
          })
        : { ...snapshot, remainingMoves: [] as CcPendingMove[] };
    const nextTechs =
      reconciled.remainingMoves.length > 0
        ? withDerivedTechAvailability(reconciled.techs)
        : reconciled.techs;
    if (reconciled.remainingMoves.length !== pendingMoves.length) {
      setPendingMoves(reconciled.remainingMoves);
    }
    setPool(reconciled.pool);
    setTechs(nextTechs);
    if (reconciled.remainingMoves.length > 0) {
      const derived = deriveOptimisticSummaryAndKpis({
        pool: reconciled.pool,
        techs: nextTechs,
        stages: reconciled.stages,
        baseKpis: data.kpis,
      });
      setKpis(derived.kpis);
      setLiveSummary(derived.liveSummary);
    } else {
      setKpis(data.kpis);
      setLiveSummary(data.live_summary);
    }
    setApprovalQueue(reconciled.stages.approval);
    setPartsQueue(reconciled.stages.parts);
    setQcQueue(reconciled.stages.qc);
    setSafetyQueue(reconciled.stages.safety);
    setPickupQueue(reconciled.stages.pickup);
    setStorageQueue(reconciled.stages.storage);
    setCompleteQueue(reconciled.stages.complete);
    setInsuranceQueue(reconciled.stages.insurance);
  }

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`control-center:${data.location_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "work_order",
          filter: `location_id=eq.${data.location_id}`,
        },
        () => {
          scheduleRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job" },
        (payload) => {
          const workOrderId = workOrderIdFromJobRealtimePayload(
            payload as {
              new?: Record<string, unknown> | null;
              old?: Record<string, unknown> | null;
            }
          );
          if (workOrderId) {
            scheduleRefresh();
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "time_clock_entry",
          filter: `location_id=eq.${data.location_id}`,
        },
        () => {
          scheduleRefresh();
        }
      )
      .subscribe();

    function handleFocusOrVisible() {
      if (document.visibilityState === "hidden") return;
      scheduleRefresh();
    }

    window.addEventListener("focus", handleFocusOrVisible);
    document.addEventListener("visibilitychange", handleFocusOrVisible);

    return () => {
      window.removeEventListener("focus", handleFocusOrVisible);
      document.removeEventListener("visibilitychange", handleFocusOrVisible);
      void supabase.removeChannel(channel);
    };
  }, [data.location_id, scheduleRefresh]);

  const sensors = useBoardDragSensors(6);

  const canRearrange = canRearrangeControlCenter(data.role);
  const canPlaceOnTech = canAssign || canRearrange;
  const { setNodeRef: setPoolRef, isOver: poolOver } = useDroppable({
    id: POOL_ID,
    disabled: !canPlaceOnTech,
  });
  const { collapsed: poolCollapsed, toggle: togglePool } = useCollapsedSection("pool");

  const stageQueues = useMemo(
    () =>
      ({
        approval: approvalQueue,
        parts: partsQueue,
        qc: qcQueue,
        safety: safetyQueue,
        pickup: pickupQueue,
        storage: storageQueue,
        complete: completeQueue,
        insurance: insuranceQueue,
      }) as Record<CcStageDropId, WaitingStageBike[]>,
    [
      approvalQueue,
      partsQueue,
      qcQueue,
      safetyQueue,
      pickupQueue,
      storageQueue,
      completeQueue,
      insuranceQueue,
    ]
  );
  const knownWorkOrderIds = useMemo(
    () =>
      collectControlCenterWorkOrderIds({
        pool,
        techs,
        stages: stageQueues,
        pendingWorkOrderId: pendingMoves[pendingMoves.length - 1]?.workOrderId ?? null,
      }),
    [pool, techs, stageQueues, pendingMoves]
  );
  useEffect(() => {
    knownWorkOrderIdsRef.current = knownWorkOrderIds;
  }, [knownWorkOrderIds]);

  const allBikes = useMemo(() => {
    const map = new Map<string, ControlCenterBike>();
    for (const bike of pool) map.set(bike.work_order_id, bike);
    for (const tech of techs) {
      for (const bike of tech.assigned_bikes) map.set(bike.work_order_id, bike);
    }
    return map;
  }, [pool, techs]);

  const visiblePool = useMemo(
    () => pool.filter((bike) => isControlCenterDispatchStatus(bike.status)),
    [pool]
  );

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
    if (
      pool.some(
        (b) => b.work_order_id === workOrderId && isControlCenterDispatchStatus(b.status)
      )
    ) {
      return POOL_ID;
    }
    for (const tech of techs) {
      if (
        tech.assigned_bikes.some(
          (b) =>
            b.work_order_id === workOrderId && isControlCenterDispatchStatus(b.status)
        )
      ) {
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
    if (stageId === "approval") setApprovalQueue(items);
    else if (stageId === "parts") setPartsQueue(items);
    else if (stageId === "qc") setQcQueue(items);
    else if (stageId === "safety") setSafetyQueue(items);
    else if (stageId === "pickup") setPickupQueue(items);
    else if (stageId === "storage") setStorageQueue(items);
    else if (stageId === "insurance") setInsuranceQueue(items);
    else setCompleteQueue(items);
  }

  function snapshotBoard() {
    return {
      pool,
      techs,
      kpis,
      liveSummary,
      approvalQueue,
      partsQueue,
      qcQueue,
      safetyQueue,
      pickupQueue,
      storageQueue,
      completeQueue,
      insuranceQueue,
    };
  }

  function restoreBoard(
    previous: ReturnType<typeof snapshotBoard>,
    failedWorkOrderId?: string
  ) {
    if (failedWorkOrderId) {
      setPendingMoves((current) =>
        current.filter((item) => item.workOrderId !== failedWorkOrderId)
      );
    } else {
      setPendingMoves([]);
    }
    setPool(previous.pool);
    setTechs(previous.techs);
    setKpis(previous.kpis);
    setLiveSummary(previous.liveSummary);
    setApprovalQueue(previous.approvalQueue);
    setPartsQueue(previous.partsQueue);
    setQcQueue(previous.qcQueue);
    setSafetyQueue(previous.safetyQueue);
    setPickupQueue(previous.pickupQueue);
    setStorageQueue(previous.storageQueue);
    setCompleteQueue(previous.completeQueue);
    setInsuranceQueue(previous.insuranceQueue);
  }

  function upsertPendingMove(nextMove: CcPendingMove) {
    setPendingMoves((current) => [
      ...current.filter((item) => item.workOrderId !== nextMove.workOrderId),
      nextMove,
    ]);
  }

  function toDispatchBike(
    source: ControlCenterBike | WaitingStageBike,
    status: WorkOrderStatus,
    technicianId: string | null
  ): ControlCenterBike {
    if ("bike_title" in source) {
      const stage = getGalleryStageForStatus(status);
      return {
        ...source,
        status,
        technician_id: technicianId,
        stage_label: stage.label,
        stage_tone: stage.tone,
      };
    }
    const stage = getGalleryStageForStatus(status);
    return {
      work_order_id: source.work_order_id,
      work_order_number: source.work_order_number,
      status,
      date_created: source.ready_since,
      opened_at: null,
      technician_id: technicianId,
      customer_name: source.customer_name ?? "",
      customer_phone: source.customer_phone ?? null,
      customer_email: source.customer_email ?? null,
      customer_sms_opted_out: Boolean(source.customer_sms_opted_out),
      bike_title: source.motorcycle_label,
      primary_photo_url: source.primary_photo_url,
      stage_label: stage.label,
      stage_tone: stage.tone,
      flags: [],
      flag_badge: null,
      at_risk: false,
      status_dot: "green",
      last_job_activity_at: null,
    };
  }

  function applyOptimisticAssign(workOrderId: string, targetId: string) {
    const bike = allBikes.get(workOrderId);
    if (!bike) return null;
    const previous = snapshotBoard();
    const lists = removeWorkOrderFromControlCenterLists({
      workOrderId,
      pool,
      techs,
      stages: stageQueues,
    });
    const moved = {
      ...bike,
      technician_id: targetId === POOL_ID ? null : targetId,
    };
    const nextPool = targetId === POOL_ID ? [moved, ...lists.pool] : lists.pool;
    const nextTechs = withDerivedTechAvailability(
      targetId === POOL_ID
        ? lists.techs
        : lists.techs.map((tech) =>
            tech.user_id === targetId
              ? { ...tech, assigned_bikes: [...tech.assigned_bikes, moved] }
              : tech
          )
    );
    const derived = deriveOptimisticSummaryAndKpis({
      pool: nextPool,
      techs: nextTechs,
      stages: lists.stages,
      baseKpis: kpis,
    });
    setPool(nextPool);
    setTechs(nextTechs);
    setKpis(derived.kpis);
    setLiveSummary(derived.liveSummary);
    setApprovalQueue(lists.stages.approval);
    setPartsQueue(lists.stages.parts);
    setQcQueue(lists.stages.qc);
    setSafetyQueue(lists.stages.safety);
    setPickupQueue(lists.stages.pickup);
    setStorageQueue(lists.stages.storage);
    setCompleteQueue(lists.stages.complete);
    setInsuranceQueue(lists.stages.insurance);
    upsertPendingMove({
      workOrderId,
      containerId: targetId,
      dispatchBike: moved,
      stageBike: null,
    });
    return previous;
  }

  function applyOptimisticStatusMove(workOrderId: string, stageId: CcStageDropId) {
    const previous = snapshotBoard();
    const source = allBikes.get(workOrderId) ?? stageBikeMap.get(workOrderId) ?? null;
    if (!source) return null;
    const wasInComplete = completeQueue.some((b) => b.work_order_id === workOrderId);

    const lists = removeWorkOrderFromControlCenterLists({
      workOrderId,
      pool,
      techs,
      stages: stageQueues,
    });
    const nextItem = toStageBike(source, stageId);
    const nextStages = {
      ...lists.stages,
      [stageId]: [nextItem, ...lists.stages[stageId]],
    };
    const nextTechs = withDerivedTechAvailability(lists.techs);
    const completedDelta =
      stageId === "complete" && !wasInComplete
        ? 1
        : stageId !== "complete" && wasInComplete
          ? -1
          : 0;
    const derived = deriveOptimisticSummaryAndKpis({
      pool: lists.pool,
      techs: nextTechs,
      stages: nextStages,
      baseKpis: kpis,
      completedDelta,
    });
    setPool(lists.pool);
    setTechs(nextTechs);
    setKpis(derived.kpis);
    setLiveSummary(derived.liveSummary);
    for (const id of Object.keys(nextStages) as CcStageDropId[]) {
      setStageQueue(id, nextStages[id]);
    }
    upsertPendingMove({
      workOrderId,
      containerId: stageId,
      dispatchBike: allBikes.get(workOrderId) ?? null,
      stageBike: nextItem,
    });
    return previous;
  }

  function applyOptimisticStageToAssign(workOrderId: string, targetId: string) {
    const source = allBikes.get(workOrderId) ?? stageBikeMap.get(workOrderId) ?? null;
    if (!source) return null;
    const previous = snapshotBoard();
    const wasInComplete = completeQueue.some((b) => b.work_order_id === workOrderId);
    const lists = removeWorkOrderFromControlCenterLists({
      workOrderId,
      pool,
      techs,
      stages: stageQueues,
    });
    const nextStatus: WorkOrderStatus =
      targetId === POOL_ID ? "ready_for_technician" : "in_progress";
    const moved = toDispatchBike(
      source,
      nextStatus,
      targetId === POOL_ID ? null : targetId
    );
    const nextPool = targetId === POOL_ID ? [moved, ...lists.pool] : lists.pool;
    const nextTechs = withDerivedTechAvailability(
      targetId === POOL_ID
        ? lists.techs
        : lists.techs.map((tech) =>
            tech.user_id === targetId
              ? { ...tech, assigned_bikes: [...tech.assigned_bikes, moved] }
              : tech
          )
    );
    const derived = deriveOptimisticSummaryAndKpis({
      pool: nextPool,
      techs: nextTechs,
      stages: lists.stages,
      baseKpis: kpis,
      completedDelta: wasInComplete ? -1 : 0,
    });
    setApprovalQueue(lists.stages.approval);
    setPartsQueue(lists.stages.parts);
    setQcQueue(lists.stages.qc);
    setSafetyQueue(lists.stages.safety);
    setPickupQueue(lists.stages.pickup);
    setStorageQueue(lists.stages.storage);
    setCompleteQueue(lists.stages.complete);
    setInsuranceQueue(lists.stages.insurance);
    setPool(nextPool);
    setTechs(nextTechs);
    setKpis(derived.kpis);
    setLiveSummary(derived.liveSummary);
    upsertPendingMove({
      workOrderId,
      containerId: targetId,
      dispatchBike: moved,
      stageBike: null,
    });
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

    const dropAllowed = allowsControlCenterDrop({
      role: data.role,
      currentStatus,
      targetId,
      poolId: POOL_ID,
      techIds,
    });

    if (isCcStageDropId(targetId)) {
      if (!dropAllowed) {
        setErrorMessage("You do not have permission to move this bike there.");
        flushRefresh();
        return;
      }

      // Dropping discards stale refreshes queued during drag; they would overwrite
      // optimistic placement with pre-drop server props (snap-back).
      cancelRefresh();
      const noticeBike =
        allBikes.get(workOrderId) ?? stageBikeMap.get(workOrderId) ?? null;
      const previous = applyOptimisticStatusMove(workOrderId, targetId);
      if (!previous) {
        flushRefresh();
        return;
      }

      startTransition(async () => {
        const result = await moveWorkOrderOnBoardAction(workOrderId, targetId);
        if (result.error) {
          restoreBoard(previous, workOrderId);
          setErrorMessage(result.error);
        } else if (
          shouldPromptPickupNotice({ targetColumnId: targetId, moveSucceeded: true })
        ) {
          setPickupNotice(pickupNoticeFromBoardBike(noticeBike, workOrderId));
        }
        scheduleRefresh();
      });
      return;
    }

    if (!dropAllowed) {
      setErrorMessage("You do not have permission to assign technicians.");
      flushRefresh();
      return;
    }

    if (fromStage && !fromAssign) {
      const columnId = assignBoardColumnForTarget(targetId, POOL_ID);

      cancelRefresh();
      const previous = applyOptimisticStageToAssign(workOrderId, targetId);
      if (!previous) {
        flushRefresh();
        return;
      }

      startTransition(async () => {
        const statusResult = await moveWorkOrderOnBoardAction(workOrderId, columnId);
        if (statusResult.error) {
          restoreBoard(previous, workOrderId);
          setErrorMessage(statusResult.error);
          scheduleRefresh();
          return;
        }
        const assignResult =
          targetId === POOL_ID
            ? await unassignWorkOrderJobsAction(workOrderId)
            : await dispatchWorkOrderToTechnicianAction(workOrderId, targetId);
        if (assignResult.error) {
          restoreBoard(previous, workOrderId);
          setErrorMessage(assignResult.error);
        }
        scheduleRefresh();
      });
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
        restoreBoard(previous, workOrderId);
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
            activeAssignedJobCount: tech.assigned_bikes.filter((bike) =>
              isControlCenterDispatchStatus(bike.status)
            ).length,
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
  const canDragCompleted = canDragCcBike(data.role, "completed", {
    mode: "stage",
    canAssign,
  });
  const canDragDispatchBike = canPlaceOnTech || canParkAnyBikeInStorage(data.role);
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
        measuring={{
          droppable: { strategy: MeasuringStrategy.Always },
        }}
        autoScroll={{
          threshold: { x: 0.2, y: 0.12 },
          acceleration: 12,
          canScroll: canAutoScrollControlCenter,
        }}
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
          className={[
            "cc-pool",
            poolCollapsed ? "cc-pool--collapsed" : "",
            poolOver && canPlaceOnTech ? "cc-pool--over" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div
            className={[
              "cc-pool-header",
              poolCollapsed ? "cc-pool-header--collapsed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <button
              type="button"
              className="cc-collapse-toggle"
              aria-expanded={!poolCollapsed}
              aria-controls="cc-section-pool"
              onClick={togglePool}
            >
              <ChevronDown
                size={18}
                strokeWidth={2.25}
                aria-hidden
                className={
                  poolCollapsed
                    ? "cc-collapse-chevron cc-collapse-chevron--collapsed"
                    : "cc-collapse-chevron"
                }
              />
              <div className="cc-pool-title-row">
                <h2 className="cc-pool-title">Waiting for tech</h2>
                <span className="shop-board-column-count">{visiblePool.length}</span>
                <span className="cc-pool-caption">
                  {canAssign
                    ? "Unassigned — drag onto a tech to dispatch"
                    : canRearrange
                      ? "Drag a bike onto a tech or into a category"
                      : canDragDispatchBike
                        ? "Drag a bike to Storage"
                        : "Unassigned bikes (view only — you cannot assign)"}
                </span>
              </div>
            </button>
            {poolCollapsed ? null : (
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
            )}
          </div>
          {poolCollapsed ? null : (
            <div id="cc-section-pool" ref={carouselRef} className="cc-carousel">
              {visiblePool.length === 0 ? (
                <div className="cc-pool-empty">
                  All bikes are dispatched. Drag one back here to unassign.
                </div>
              ) : (
                visiblePool.map((bike) => (
                  <PoolBikeCard
                    key={bike.work_order_id}
                    bike={bike}
                    canDrag={canDragDispatchBike}
                    dragging={activeId === bike.work_order_id}
                    onOpenWork={handleOpenWork}
                  />
                ))
              )}
            </div>
          )}
        </section>

        <div className="cc-tech-grid">
          {techs.map((tech) => (
            <TechCard
              key={tech.user_id}
              tech={{
                ...tech,
                assigned_bikes: tech.assigned_bikes.filter((bike) =>
                  isControlCenterDispatchStatus(bike.status)
                ),
              }}
              canAssign={canAssign}
              canReceiveDrops={canPlaceOnTech}
              canDragBikes={canDragDispatchBike}
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
          <WaitingForApprovalCarousel
            items={approvalQueue}
            sectionId="approval"
            dnd={{
              ...stageDndBase,
              droppableId: "approval",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "approval"),
            }}
          />
          <WaitingForPartsCarousel
            items={partsQueue}
            sectionId="parts"
            dnd={{
              ...stageDndBase,
              droppableId: "parts",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "parts"),
            }}
          />
          <ReadyForQcCarousel
            items={qcQueue}
            sectionId="qc"
            dnd={{
              ...stageDndBase,
              droppableId: "qc",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "qc"),
            }}
          />
          <ReadyForSafetyInspectionCarousel
            items={safetyQueue}
            sectionId="safety"
            dnd={{
              ...stageDndBase,
              droppableId: "safety",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "safety"),
            }}
          />
          <ReadyForPickupCarousel
            items={pickupQueue}
            sectionId="pickup"
            dnd={{
              ...stageDndBase,
              droppableId: "pickup",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "pickup"),
            }}
          />
          <StorageCarousel
            items={storageQueue}
            sectionId="storage"
            dnd={{
              ...stageDndBase,
              droppableId: "storage",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "storage"),
            }}
          />
          <CompleteCarousel
            items={completeQueue}
            sectionId="complete"
            dnd={{
              ...stageDndBase,
              dragEnabled: canDragCompleted,
              droppableId: "complete",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "complete"),
            }}
          />
          <InsuranceBikesCarousel
            items={insuranceQueue}
            sectionId="insurance"
            dnd={{
              ...stageDndBase,
              droppableId: "insurance",
              dropDisabled: !isCcStageDropEnabledForRole(data.role, "insurance"),
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
                  <img src={activeStageBike.primary_photo_url} alt="" draggable={false} />
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
                <p className="cc-bike-subtitle">
                  {activeStageBike.customer_name
                    ? `${activeStageBike.customer_name} · ${activeStageBike.work_order_number}`
                    : activeStageBike.work_order_number}
                </p>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {pickupNotice ? (
        <PickupNoticeDialog
          contact={pickupNotice}
          locationCode={data.location_code}
          onClose={() => setPickupNotice(null)}
        />
      ) : null}
    </div>
  );
}
