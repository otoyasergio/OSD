"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Images, StickyNote } from "lucide-react";
import { useBoardDragSensors } from "@/lib/client/useBoardDragSensors";
import { createClient } from "@/lib/database/supabase-browser";
import type { TechnicianFloorOs } from "@/lib/services/technicianFloor";
import type { DocketItem } from "@/lib/services/technicianDocket";
import type { ReadyForPickupItem } from "@/lib/services/readyForPickup";
import { TechnicianDocketList } from "@/components/technician/TechnicianDocketList";
import { BenchDropZone } from "@/components/technician/BenchDropZone";
import { ReadyForPickupCarousel } from "@/components/technician/ReadyForPickupCarousel";
import { FloorStageSpine } from "@/components/technician/FloorStageSpine";
import { FloorCurrentStep } from "@/components/technician/FloorCurrentStep";
import { FloorDock } from "@/components/technician/FloorDock";
import { SignOffPad } from "@/components/inspections/SignOffPad";
import {
  failSafetyCheckAction,
  passSafetyCheckAction,
} from "@/app/(app)/work_orders/safety-actions";
import {
  acknowledgeDocketJobAction,
  completeJobFloorAction,
  completePerformWorkAction,
  failPeerQcAction,
  installPartFloorAction,
  parkJobAction,
  passPeerQcAction,
  pullOntoBenchAction,
  resumeParkedJobAction,
  skipProofAction,
  swapBenchJobAction,
  toggleChecklistAction,
  uploadJobProofAction,
  type FloorActionState,
} from "@/app/(app)/technician/floor-actions";
import { techJobPacketHref } from "@/lib/technician/assignmentHref";
import {
  technicianClosePacketHref,
  technicianFloorHref,
  type JobPacketSection,
} from "@/lib/technician/routeState";
import type { JobPacket } from "@/lib/services/jobPacket";
import type { IntakePhoto } from "@/lib/services/photos";
import { JobPacketPanel } from "@/components/technician/JobPacketPanel";
import {
  currentPitStep,
  deriveDefaultStage,
  floorSpineStates,
  type FloorStage,
} from "@/lib/technician/floorStage";
import {
  PARK_REASON_OPTIONS,
  isFloorJobFinished,
  type PitBoardStep,
} from "@/lib/technician/pitBoard";
import {
  buildFloorActionModel,
  splitDocketByWait,
  waitOwnerDisplayLabel,
  type FloorActionModel,
} from "@/lib/technician/floorActionModel";
import {
  TECH_BENCH_DROP_ID,
  benchDropActionForItem,
  findDocketItemByDragId,
} from "@/lib/technician/benchDrag";
import { useDebouncedRouterRefresh } from "@/lib/client/useDebouncedRouterRefresh";

const benchCollision: CollisionDetection = (args) => pointerWithin(args);

export type { FloorStage };
export { deriveDefaultStage };

function formatTimer(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function ActionMessage({ state }: { state: FloorActionState }) {
  if (!state?.error && !state?.success) return null;
  return (
    <p
      className={`floor-dock-msg ${state.error ? "floor-dock-msg--error" : "floor-dock-msg--ok"}`}
      role="status"
    >
      {state.error ?? state.success}
    </p>
  );
}

function JobPacketErrorState({ backHref }: { backHref: string }) {
  return (
    <div className="floor-surface-empty floor-packet-error">
      <h2 className="floor-section-title">Couldn&apos;t open notes &amp; photos</h2>
      <p className="floor-muted">
        This work order may be unavailable or you may not have access.
      </p>
      <Link href={backHref} className="btn btn-secondary floor-tap floor-tap--wide">
        Back to jobs
      </Link>
    </div>
  );
}

type Overlay = null | "park" | "fail" | "swap" | "qc_pick" | "sign_qc" | "sign_safety";

/**
 * Identity-bound floor actions: acknowledgement, bench/timer flows, and QC or
 * safety judgements belong to the technician, so an owner previewing their
 * floor gets them disabled. Everything else stays interactive as a clearly
 * owner-attributed override.
 */
const PREVIEW_LOCKED_ACTIONS = new Set([
  "acknowledge",
  "pull_onto_bench",
  "resume",
  "pass_qc",
  "fail_qc",
  "pass_safety",
  "fail_safety",
  "park",
  "swap",
]);

const PREVIEW_LOCK_REASON =
  "Preview only — this action belongs to the technician you are viewing.";

function applyPreviewLock(model: FloorActionModel): FloorActionModel {
  return {
    ...model,
    primary: PREVIEW_LOCKED_ACTIONS.has(model.primary.action)
      ? { ...model.primary, enabled: false, disabledReason: PREVIEW_LOCK_REASON }
      : model.primary,
    secondary: model.secondary.map((control) =>
      PREVIEW_LOCKED_ACTIONS.has(control.action)
        ? { ...control, enabled: false, disabledReason: PREVIEW_LOCK_REASON }
        : control
    ),
  };
}

export function TechnicianFloorShell({
  floor,
  stage,
  viewerUserId,
  previewMode = false,
  docketItems,
  readyForPickup,
  panel,
  packet,
  packetSection,
  packetPhotos,
  packetWorkOrderId,
  packetJobId,
}: {
  floor: TechnicianFloorOs;
  stage?: FloorStage;
  /** Read-subject tech — scopes the realtime job subscription. */
  viewerUserId?: string;
  /** Owner "view as technician" — disables identity-bound floor actions. */
  previewMode?: boolean;
  docketItems: DocketItem[];
  readyForPickup: ReadyForPickupItem[];
  panel?: "packet" | null;
  packet?: JobPacket | null;
  packetSection?: JobPacketSection | null;
  packetPhotos?: IntakePhoto[];
  packetWorkOrderId?: string | null;
  packetJobId?: string | null;
}) {
  const router = useRouter();
  const surface = floor.selected;
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<DocketItem | null>(null);
  const shopDndEnabled = !previewMode;
  const dragSensors = useBoardDragSensors(8);
  // The stage param controls the visible work-surface emphasis; without it we
  // fall back to the derived default for this surface.
  const activeStage: FloorStage | null =
    stage ?? (surface ? deriveDefaultStage(surface) : null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [qcChecks, setQcChecks] = useState<boolean[]>([false, false, false]);
  const [note, setNote] = useState<string | null>(null);
  const [timerSecs, setTimerSecs] = useState(surface?.timer_secs ?? 0);
  const [, startTransition] = useTransition();
  const overlayRef = useRef(overlay);
  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);
  const { schedule: scheduleRefresh, flush: flushRefresh } = useDebouncedRouterRefresh({
    delayMs: 800,
    isPaused: () => overlayRef.current !== null,
  });

  const [ackState, ackAction, ackPending] = useActionState(
    acknowledgeDocketJobAction,
    null
  );
  const [pullState, pullAction, pullPending] = useActionState(pullOntoBenchAction, null);
  const [parkState, parkAction, parkPending] = useActionState(parkJobAction, null);
  const [resumeState, resumeAction, resumePending] = useActionState(
    resumeParkedJobAction,
    null
  );
  const [swapState, swapAction, swapPending] = useActionState(swapBenchJobAction, null);
  const [completeState, completeAction, completePending] = useActionState(
    completeJobFloorAction,
    null
  );
  const [toggleState, toggleAction] = useActionState(toggleChecklistAction, null);
  const [installState, installAction, _installPending] = useActionState(
    installPartFloorAction,
    null
  );
  const [proofState, proofAction, proofPending] = useActionState(
    uploadJobProofAction,
    null
  );
  const [skipState, skipAction, skipPending] = useActionState(skipProofAction, null);
  const [workState, workAction, workPending] = useActionState(
    completePerformWorkAction,
    null
  );
  const [passQcState, passQcAction, passQcPending] = useActionState(
    passPeerQcAction,
    null
  );
  const [failQcState, failQcAction, failQcPending] = useActionState(
    failPeerQcAction,
    null
  );
  const [passSafetyState, passSafetyFormAction, passSafetyPending] = useActionState(
    async (_prev: FloorActionState, formData: FormData): Promise<FloorActionState> => {
      const workOrderId = String(formData.get("work_order_id") ?? "");
      const result = await passSafetyCheckAction(workOrderId, { error: null }, formData);
      if (result.error) return { error: result.error };
      return { success: "Final inspection passed." };
    },
    null
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync timer from server surface
    setTimerSecs(surface?.timer_secs ?? 0);
  }, [surface?.job_id, surface?.timer_secs]);

  useEffect(() => {
    if (!surface?.job_timer_running || surface.board_status !== "bench") return;
    const id = window.setInterval(() => setTimerSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [surface?.job_timer_running, surface?.board_status, surface?.job_id]);

  useEffect(() => {
    const states = [
      ackState,
      pullState,
      parkState,
      resumeState,
      swapState,
      completeState,
      skipState,
      workState,
      passQcState,
      failQcState,
      passSafetyState,
    ];
    for (const s of states) {
      if (s?.success) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- close overlays after floor actions succeed
        setNote(s.success);
        setOverlay(null);
        startTransition(() => scheduleRefresh());
        break;
      }
      if (s?.error) {
        setNote(s.error);
        break;
      }
    }
  }, [
    ackState,
    pullState,
    parkState,
    resumeState,
    swapState,
    completeState,
    skipState,
    workState,
    passQcState,
    failQcState,
    passSafetyState,
    scheduleRefresh,
  ]);

  useEffect(() => {
    if (overlay === null) {
      flushRefresh();
    }
  }, [overlay, flushRefresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [scheduleRefresh]);

  // Stable membership key so we only resubscribe when the docket changes.
  const docketWoKey = useMemo(() => {
    const ids = new Set(docketItems.map((item) => item.work_order_id));
    if (surface) ids.add(surface.work_order_id);
    return [...ids].sort().join(",");
  }, [docketItems, surface]);

  useEffect(() => {
    // Live invalidation: cancelled/held/reassigned work disappears from
    // already-open floors without a manual reload. Refreshes are debounced
    // and paused while an overlay sheet is open.
    if (!viewerUserId) return;
    const supabase = createClient();
    const channel = supabase.channel(`tech-floor:${viewerUserId}`);
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "job",
        filter: `assigned_technician_id=eq.${viewerUserId}`,
      },
      () => {
        scheduleRefresh();
      }
    );
    if (docketWoKey.length > 0) {
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "work_order",
          filter: `work_order_id=in.(${docketWoKey})`,
        },
        () => {
          scheduleRefresh();
        }
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [viewerUserId, docketWoKey, scheduleRefresh]);

  const selectedKey = useMemo(() => {
    if (!surface) return null;
    if (surface.is_qc) return `qc-${surface.work_order_id}`;
    if (surface.is_safety) return `safety-${surface.work_order_id}`;
    return `work-order-${surface.work_order_id}`;
  }, [surface]);

  // A bike appears in exactly one list: working or honestly waiting.
  const { workNow: workNowItems, waiting: waitingItems } = splitDocketByWait(docketItems);
  const shopItems = useMemo(
    () => [...workNowItems, ...waitingItems],
    [workNowItems, waitingItems]
  );
  const benchBikeLabel =
    docketItems.find((item) => item.board_status === "bench")?.motorcycle_label ??
    (surface?.board_status === "bench" ? surface.motorcycle_label : null);
  const swapTargets = docketItems.filter(
    (item) =>
      item.job_id &&
      item.job_id !== surface?.job_id &&
      (item.board_status === "next" ||
        item.board_status === "waiting" ||
        item.board_status === "offered")
  );

  const onBench = surface?.board_status === "bench";
  const parked = surface?.board_status === "waiting";
  const openPerformWorkStep = surface?.steps.find(
    (step) => step.kind === "work" && step.state === "open"
  );
  const openPerformWorkItemId = openPerformWorkStep?.target_id ?? "";
  const visibleStep =
    surface && activeStage ? currentPitStep(surface.steps, activeStage) : null;
  const remainingCount = surface
    ? surface.steps.filter((step) => step.state === "open" && step.id !== visibleStep?.id)
        .length
    : 0;
  const spineStates = surface
    ? floorSpineStates(surface.steps, activeStage ?? "inspect")
    : null;

  const qcAllDone = qcChecks.every(Boolean);

  // Park actions manage their own disabled state — don't lock the whole floor.
  const pending =
    ackPending ||
    pullPending ||
    resumePending ||
    swapPending ||
    completePending ||
    proofPending ||
    skipPending ||
    workPending ||
    passQcPending ||
    failQcPending;

  // One honest next action (or an explicit wait with a named owner).
  const builtModel: FloorActionModel | null = surface
    ? buildFloorActionModel({
        surface: surface.is_safety
          ? "safety"
          : surface.is_qc && !surface.job_id
            ? "qc"
            : "job",
        job_status: surface.job_status,
        work_order_status: surface.wo_status,
        floor_acknowledged_at: surface.floor_acknowledged_at,
        floor_parked_at: surface.floor_parked_at,
        floor_park_reason: surface.floor_park_reason,
        job_timer_running: surface.job_timer_running,
        steps: surface.steps,
        complete_gate_ok: surface.complete_gate_ok,
        qc_checks_done: qcAllDone,
        qc_assignee_is_me: surface.qc_assignee_is_me,
        can_safety: surface.can_safety,
        has_swap_targets: swapTargets.length > 0,
        pending_action: pending,
      })
    : null;
  const model = builtModel && previewMode ? applyPreviewLock(builtModel) : builtModel;
  const parkControl = model?.secondary.find((control) => control.action === "park");
  const swapControl = model?.secondary.find((control) => control.action === "swap");
  const failQcControl = model?.secondary.find((control) => control.action === "fail_qc");

  function dispatchFloorAction(
    action: (payload: FormData) => void,
    fields: Record<string, string>
  ) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      fd.set(key, value);
    }
    startTransition(() => {
      action(fd);
    });
  }

  function onShopDragStart(event: DragStartEvent) {
    const item = findDocketItemByDragId(docketItems, String(event.active.id));
    if (!item) return;
    setActiveDragItem(item);
    setDraggingKey(item.key);
  }

  function onShopDragEnd(event: DragEndEvent) {
    setActiveDragItem(null);
    setDraggingKey(null);
    if (event.over?.id !== TECH_BENCH_DROP_ID) return;

    const item = findDocketItemByDragId(docketItems, String(event.active.id));
    if (!item?.job_id) return;

    const dropAction = benchDropActionForItem(item);
    if (!dropAction) return;

    if (dropAction === "resume") {
      dispatchFloorAction(resumeAction, {
        job_id: item.job_id,
        work_order_id: item.work_order_id,
      });
    } else {
      dispatchFloorAction(pullAction, {
        job_id: item.job_id,
        work_order_id: item.work_order_id,
      });
    }
    router.push(item.href);
  }

  function onShopDragCancel() {
    setActiveDragItem(null);
    setDraggingKey(null);
  }

  function runGo() {
    if (!surface || !model || !model.primary.enabled) return;
    const primary = model.primary;
    if (primary.action === "acknowledge" && surface.job_id) {
      dispatchFloorAction(ackAction, {
        job_id: surface.job_id,
        work_order_id: surface.work_order_id,
      });
      return;
    }
    if (primary.action === "pull_onto_bench" && surface.job_id) {
      dispatchFloorAction(pullAction, {
        job_id: surface.job_id,
        work_order_id: surface.work_order_id,
      });
      return;
    }
    if (primary.action === "resume" && surface.job_id) {
      dispatchFloorAction(resumeAction, {
        job_id: surface.job_id,
        work_order_id: surface.work_order_id,
      });
      return;
    }
    if (primary.action === "complete" && surface.job_id) {
      setOverlay("qc_pick");
      return;
    }
    if (primary.action === "pass_qc") {
      setOverlay("sign_qc");
      return;
    }
    if (primary.action === "pass_safety") {
      setOverlay("sign_safety");
      return;
    }
    if (primary.action === "advance_step" && primary.step) {
      advanceStep(primary.step);
    }
  }

  function advanceStep(step: PitBoardStep) {
    if (!surface) return;
    if (step.kind === "inspect") {
      router.push(surface.inspection_href);
      return;
    }
    if (step.kind === "work") {
      if (surface.job_id && openPerformWorkItemId) {
        dispatchFloorAction(workAction, {
          job_id: surface.job_id,
          work_order_id: surface.work_order_id,
          item_id: openPerformWorkItemId,
        });
      }
      return;
    }
    if (step.kind === "checklist" && step.target_id) {
      const fd = new FormData();
      fd.set("item_id", step.target_id);
      fd.set("checked", "true");
      fd.set("work_order_id", surface.work_order_id);
      setNote(`Done: ${step.label}`);
      startTransition(() => {
        toggleAction(fd);
        scheduleRefresh();
      });
      return;
    }
    if (step.kind === "part" && step.target_id) {
      const fd = new FormData();
      fd.set("part_id", step.target_id);
      fd.set("work_order_id", surface.work_order_id);
      installAction(fd);
      setNote(`Done: ${step.label}`);
      startTransition(() => scheduleRefresh());
      return;
    }
    if (step.kind === "proof") {
      return;
    }
    if (step.kind === "complete" && surface.job_id) {
      setOverlay("qc_pick");
    }
  }

  function completeWithQcAssignee(assigneeId: string | null) {
    if (!surface?.job_id) return;
    const fields: Record<string, string> = {
      job_id: surface.job_id,
      work_order_id: surface.work_order_id,
    };
    if (assigneeId) fields.qc_assignee_id = assigneeId;
    dispatchFloorAction(completeAction, fields);
  }

  const showPacket = panel === "packet";

  return (
    <div className="pit-shell">
      <header className="pit-topbar">
        <p className="pit-wordmark">OTOMOTO · TECH FLOOR</p>
        {previewMode ? (
          <p className="pit-preview-note" role="status">
            Owner preview — the technician&apos;s bench, timer, and QC controls are
            disabled.
          </p>
        ) : null}
        {readyForPickup.length > 0 ? (
          <div className="pit-pickup-strip">
            <ReadyForPickupCarousel items={readyForPickup} />
          </div>
        ) : null}
      </header>

      <DndContext
        sensors={dragSensors}
        collisionDetection={benchCollision}
        onDragStart={onShopDragStart}
        onDragEnd={onShopDragEnd}
        onDragCancel={onShopDragCancel}
      >
        <div className="pit-layout">
          <aside className="pit-rail">
            <section className="pit-rail-group" aria-label="In shop">
              <h2 className="pit-rail-title">In shop</h2>
              <p className="pit-rail-help">
                Bikes assigned to you. Drag one onto your workbench to start the clock.
              </p>
              {shopItems.length > 0 ? (
                <TechnicianDocketList
                  items={shopItems}
                  selectedKey={selectedKey}
                  dnd={{
                    enabled: shopDndEnabled && !pending,
                    draggingKey,
                  }}
                />
              ) : (
                <p className="floor-muted">Nothing in the shop for you right now.</p>
              )}
            </section>
          </aside>

          <BenchDropZone
            disabled={!shopDndEnabled || pending}
            benchLabel={benchBikeLabel}
          >
            <section className="pit-surface">
              {showPacket && packetWorkOrderId ? (
                packet ? (
                  <JobPacketPanel
                    packet={packet}
                    section={packetSection ?? null}
                    photos={packetPhotos ?? []}
                    selectedJobId={packetJobId ?? null}
                    closeHref={technicianClosePacketHref({
                      workOrderId: packetWorkOrderId,
                      jobId: packetJobId,
                      stage,
                    })}
                    stage={stage ?? null}
                  />
                ) : (
                  <JobPacketErrorState
                    backHref={technicianClosePacketHref({
                      workOrderId: packetWorkOrderId,
                      jobId: packetJobId,
                      stage,
                    })}
                  />
                )
              ) : !surface ? (
                <div className="floor-surface-empty">
                  <h2 className="floor-section-title">Your workbench</h2>
                  <p className="floor-muted">
                    Drag a bike from the shop list, or tap one to preview the next move.
                  </p>
                </div>
              ) : (
                <>
                  {model ? (
                    model.primary.enabled ? (
                      <p className="pit-next-banner" role="status">
                        <span className="pit-next-banner-kicker">NEXT</span>
                        {model.primary.label}
                      </p>
                    ) : (
                      <p className="pit-next-banner pit-next-banner--wait" role="status">
                        <span className="pit-next-banner-kicker">
                          {model.waitReason ? "WAITING" : model.stateLabel.toUpperCase()}
                        </span>
                        {model.waitReason ?? model.primary.disabledReason ?? ""}
                        {model.waitOwner ? (
                          <span className="pit-next-banner-owner">
                            {" · "}
                            {waitOwnerDisplayLabel(model.waitOwner)}
                          </span>
                        ) : null}
                      </p>
                    )
                  ) : null}
                  <div className="pit-surface-header">
                    <div className="pit-surface-heading">
                      <Link
                        href={techJobPacketHref(surface.work_order_id, {
                          jobId: surface.job_id ?? undefined,
                          stage,
                        })}
                        className="pit-surface-heading-link"
                        title="Open notes & intake photos"
                      >
                        <h2 className="pit-bike-title">{surface.motorcycle_label}</h2>
                        <p className="pit-meta">
                          <span className="pit-wo-chip">{surface.work_order_number}</span>
                          {surface.service_name ? (
                            <>
                              <span aria-hidden> · </span>
                              {surface.service_name}
                            </>
                          ) : null}
                        </p>
                      </Link>
                      <div
                        className="pit-header-access"
                        aria-label="Notes and intake photos"
                      >
                        <Link
                          href={techJobPacketHref(surface.work_order_id, {
                            jobId: surface.job_id ?? undefined,
                            section: "notes",
                            stage,
                          })}
                          className="pit-header-access-link pit-header-access-link--icon"
                          aria-label="Notes"
                          title="Notes"
                        >
                          <StickyNote size={22} aria-hidden />
                        </Link>
                        <Link
                          href={techJobPacketHref(surface.work_order_id, {
                            jobId: surface.job_id ?? undefined,
                            section: "photos",
                            stage,
                          })}
                          className="pit-header-access-link pit-header-access-link--icon"
                          aria-label="Intake photos"
                          title="Intake photos"
                        >
                          <Images size={22} aria-hidden />
                        </Link>
                      </div>
                    </div>
                    {(onBench || surface.board_status === "waiting") && surface.job_id ? (
                      <span className="pit-timer" aria-live="polite">
                        {formatTimer(timerSecs)}
                      </span>
                    ) : null}
                  </div>

                  {surface.job_id &&
                  !surface.is_qc &&
                  !surface.is_safety &&
                  spineStates ? (
                    <FloorStageSpine
                      workOrderId={surface.work_order_id}
                      jobId={surface.job_id}
                      activeStage={activeStage ?? "inspect"}
                      states={spineStates}
                    />
                  ) : null}

                  {note ? (
                    <p
                      className={[
                        "pit-note",
                        /cannot|failed|error|clock in|forbidden|not /i.test(note)
                          ? "pit-note--error"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      role="status"
                    >
                      {note}
                    </p>
                  ) : null}

                  {surface.pending_recommendations.length > 0 &&
                  surface.job_status !== "waiting_for_approval" &&
                  !isFloorJobFinished({
                    board_status: surface.board_status,
                    job_status: surface.job_status,
                    completed_at: surface.completed_at,
                  }) ? (
                    <p className="pit-note" role="status">
                      {surface.pending_recommendations.length} recommendation
                      {surface.pending_recommendations.length === 1 ? "" : "s"} on hold
                      for the client (approve later → new docket job; decline → stay
                      finished). You can complete this job now.
                    </p>
                  ) : null}

                  {surface.jobs.filter((j) => j.assigned_to_me).length > 1 ? (
                    <div className="pit-job-switch" aria-label="Services on this bike">
                      {surface.jobs
                        .filter((j) => j.assigned_to_me)
                        .map((job) => (
                          <Link
                            key={job.job_id}
                            href={technicianFloorHref({
                              workOrderId: surface.work_order_id,
                              jobId: job.job_id,
                            })}
                            className={[
                              "pit-job-chip",
                              job.is_selected ? "pit-job-chip--active" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {job.service_name}
                            <span className="pit-job-chip-status">
                              {job.status_label}
                            </span>
                          </Link>
                        ))}
                    </div>
                  ) : null}

                  <div className="pit-surface-body">
                    <FloorCurrentStep
                      surface={surface}
                      activeStage={activeStage ?? "inspect"}
                      currentStep={visibleStep}
                      remainingCount={remainingCount}
                      parked={parked}
                      qcChecks={qcChecks}
                      onToggleQc={(index) =>
                        setQcChecks((prev) => {
                          const next = [...prev];
                          next[index] = !next[index];
                          return next;
                        })
                      }
                      onOpenInspection={() => router.push(surface.inspection_href)}
                      onCompleteWork={() => {
                        if (surface.job_id && openPerformWorkItemId) {
                          dispatchFloorAction(workAction, {
                            job_id: surface.job_id,
                            work_order_id: surface.work_order_id,
                            item_id: openPerformWorkItemId,
                          });
                        }
                      }}
                      onToggleChecklist={(itemId, label) => {
                        const fd = new FormData();
                        fd.set("item_id", itemId);
                        fd.set("checked", "true");
                        fd.set("work_order_id", surface.work_order_id);
                        setNote(`Done: ${label}`);
                        startTransition(() => {
                          toggleAction(fd);
                          scheduleRefresh();
                        });
                      }}
                      onInstallPart={(partId, label) => {
                        const fd = new FormData();
                        fd.set("part_id", partId);
                        fd.set("work_order_id", surface.work_order_id);
                        installAction(fd);
                        setNote(`Done: ${label}`);
                        startTransition(() => scheduleRefresh());
                      }}
                      onParkParts={() => setOverlay("park")}
                      proofAction={proofAction}
                      skipAction={skipAction}
                      proofPending={proofPending}
                      skipPending={skipPending}
                      workPending={workPending}
                    />

                    {surface.can_safety && !previewMode ? (
                      <div className="pit-safety-actions">
                        <button
                          type="button"
                          className="btn btn-primary pit-go"
                          onClick={() => setOverlay("sign_safety")}
                        >
                          Pass final inspection ✓
                        </button>
                        <form
                          action={async (formData) => {
                            await failSafetyCheckAction(
                              surface.work_order_id,
                              { error: null },
                              formData
                            );
                            startTransition(() => scheduleRefresh());
                          }}
                        >
                          <input
                            type="hidden"
                            name="recommendation_description"
                            value="Final inspection failed on floor"
                          />
                          <button type="submit" className="btn btn-secondary">
                            Fail final inspection
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>

                  <FloorDock
                    model={model}
                    parkControl={parkControl}
                    swapControl={swapControl}
                    failQcControl={failQcControl}
                    onPark={() => setOverlay("park")}
                    onSwap={() => setOverlay("swap")}
                    onFailQc={() => setOverlay("fail")}
                    onGo={runGo}
                    message={
                      <ActionMessage
                        state={
                          pullState?.error
                            ? pullState
                            : ackState?.error
                              ? ackState
                              : resumeState?.error
                                ? resumeState
                                : completeState?.error
                                  ? completeState
                                  : toggleState?.error
                                    ? toggleState
                                    : installState?.error
                                      ? installState
                                      : proofState?.error
                                        ? proofState
                                        : workState?.error
                                          ? workState
                                          : null
                        }
                      />
                    }
                  />
                </>
              )}
            </section>
          </BenchDropZone>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDragItem ? (
            <div className="pit-queue-card pit-queue-card--drag-preview">
              <span className="pit-queue-num" aria-hidden>
                {activeDragItem.position}
              </span>
              <span className="pit-queue-body">
                <span className="pit-queue-bike">{activeDragItem.motorcycle_label}</span>
                <span className="pit-queue-sub">
                  <span className="pit-queue-wo">{activeDragItem.subtitle}</span>
                </span>
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {overlay ? (
        <div className="pit-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="pit-scrim"
            aria-label="Close"
            onClick={() => setOverlay(null)}
          />
          <div className="pit-sheet">
            {overlay === "park" && surface?.job_id ? (
              <>
                <h3 className="pit-sheet-title">Why park?</h3>
                <div className="pit-sheet-grid">
                  {PARK_REASON_OPTIONS.map((opt) => (
                    <button
                      key={opt.reason}
                      type="button"
                      className="pit-sheet-btn"
                      disabled={parkPending}
                      onClick={() =>
                        dispatchFloorAction(parkAction, {
                          job_id: surface.job_id!,
                          work_order_id: surface.work_order_id,
                          reason: opt.reason,
                        })
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {overlay === "qc_pick" && surface?.job_id ? (
              <>
                <h3 className="pit-sheet-title">Who should check your work?</h3>
                <p className="pit-sheet-or">
                  Pick a clocked-in tech. They get this bike for peer QC.
                </p>
                {surface.peer_qc_candidates.length > 0 ? (
                  <ul className="pit-sheet-list">
                    {surface.peer_qc_candidates.map((tech) => (
                      <li key={tech.user_id}>
                        <button
                          type="button"
                          className="pit-sheet-btn"
                          disabled={completePending}
                          onClick={() => completeWithQcAssignee(tech.user_id)}
                        >
                          {tech.display_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pit-sheet-or">
                    No other techs are clocked in. Front desk will cover QC.
                  </p>
                )}
                {surface.peer_qc_candidates.length === 0 ? (
                  <button
                    type="button"
                    className="pit-go"
                    disabled={completePending}
                    onClick={() => completeWithQcAssignee(null)}
                  >
                    Complete without picker ✓
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pit-sheet-close"
                  disabled={completePending}
                  onClick={() => setOverlay(null)}
                >
                  Not done yet
                </button>
                {completeState?.error ? (
                  <p className="floor-dock-msg floor-dock-msg--error" role="status">
                    {completeState.error}
                  </p>
                ) : null}
              </>
            ) : null}

            {overlay === "fail" && surface ? (
              <>
                <h3 className="pit-sheet-title">Fail peer QC</h3>
                <form action={failQcAction} className="pit-sheet-form">
                  <input
                    type="hidden"
                    name="work_order_id"
                    value={surface.work_order_id}
                  />
                  <label className="pit-sheet-label">
                    Reason
                    <textarea
                      name="reason"
                      required
                      rows={3}
                      className="pit-sheet-input"
                    />
                  </label>
                  <button type="submit" className="pit-go" disabled={failQcPending}>
                    Send back for rework
                  </button>
                </form>
              </>
            ) : null}

            {overlay === "sign_qc" && surface ? (
              <>
                <h3 className="pit-sheet-title">Sign quality check</h3>
                <p className="pit-sheet-or">
                  Draw your signature to vouch for this bike before final inspection.
                </p>
                <form
                  action={passQcAction}
                  className="pit-sheet-form flex flex-col gap-3"
                >
                  <input
                    type="hidden"
                    name="work_order_id"
                    value={surface.work_order_id}
                  />
                  <SignOffPad label="QC signature" />
                  <button type="submit" className="pit-go" disabled={passQcPending}>
                    Pass QC — vouch for it ✓
                  </button>
                </form>
                {passQcState?.error ? (
                  <p className="floor-dock-msg floor-dock-msg--error" role="status">
                    {passQcState.error}
                  </p>
                ) : null}
              </>
            ) : null}

            {overlay === "sign_safety" && surface ? (
              <>
                <h3 className="pit-sheet-title">Sign final inspection</h3>
                <p className="pit-sheet-or">
                  Draw your signature to pass final inspection and clear the bike for
                  pickup.
                </p>
                <form
                  action={passSafetyFormAction}
                  className="pit-sheet-form flex flex-col gap-3"
                >
                  <input
                    type="hidden"
                    name="work_order_id"
                    value={surface.work_order_id}
                  />
                  <SignOffPad label="Final inspection signature" />
                  <button type="submit" className="pit-go" disabled={passSafetyPending}>
                    Pass final inspection ✓
                  </button>
                </form>
                {passSafetyState?.error ? (
                  <p className="floor-dock-msg floor-dock-msg--error" role="status">
                    {passSafetyState.error}
                  </p>
                ) : null}
              </>
            ) : null}

            {overlay === "swap" && surface?.job_id ? (
              <>
                <h3 className="pit-sheet-title">Swap onto</h3>
                <ul className="pit-sheet-list">
                  {swapTargets.map((item) => (
                    <li key={item.key}>
                      <form action={swapAction}>
                        <input type="hidden" name="from_job_id" value={surface.job_id!} />
                        <input type="hidden" name="to_job_id" value={item.job_id!} />
                        <input
                          type="hidden"
                          name="work_order_id"
                          value={item.work_order_id}
                        />
                        <button
                          type="submit"
                          className="pit-sheet-btn"
                          disabled={swapPending}
                        >
                          {item.motorcycle_label}
                          <span className="pit-sheet-btn-sub">{item.service_label}</span>
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
