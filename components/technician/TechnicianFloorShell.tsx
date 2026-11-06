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
import { registerTechnicianNoteRealtime } from "@/lib/notes/realtime";
import type { FloorOsSurface, TechnicianFloorOs } from "@/lib/services/technicianFloor";
import type { DocketItem } from "@/lib/services/technicianDocket";
import type { ReadyForPickupItem } from "@/lib/services/readyForPickup";
import { TechnicianDocketList } from "@/components/technician/TechnicianDocketList";
import { BenchDropZone } from "@/components/technician/BenchDropZone";
import { ReadyForPickupCarousel } from "@/components/technician/ReadyForPickupCarousel";
import { FloorStageSpine } from "@/components/technician/FloorStageSpine";
import { FloorCurrentStep } from "@/components/technician/FloorCurrentStep";
import { FloorPhotoField } from "@/components/technician/FloorPhotoField";
import { CheckoutEvidencePanel } from "@/components/photos/CheckoutEvidencePanel";
import { FloorDock } from "@/components/technician/FloorDock";
import { SignOffPad } from "@/components/inspections/SignOffPad";
import {
  failSafetyCheckAction,
  passSafetyCheckAction,
} from "@/app/(app)/work_orders/safety-actions";
import {
  acknowledgeDocketJobAction,
  clearToolWaitAction,
  completeJobFloorAction,
  completePerformWorkAction,
  failPeerQcAction,
  installPartFloorAction,
  parkJobAction,
  passPeerQcAction,
  pullOntoBenchAction,
  resumeParkedJobAction,
  skipProofAction,
  toggleChecklistAction,
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
import type { AskOtomotoPanelData } from "@/lib/diagnostics/askOtomotoView";
import type { DiagnosticPanelData } from "@/lib/diagnostics/sessionView";
import {
  currentPitStep,
  deriveDefaultStage,
  floorSpineStates,
  type FloorStage,
} from "@/lib/technician/floorStage";
import {
  isFloorJobFinished,
  PARK_REASON_OPTIONS,
  type PitBoardStep,
} from "@/lib/technician/pitBoard";
import {
  evaluatePerformWorkDocumentation,
  hasWorkPhotoChoice,
  hasWrittenWorkLine,
  journalFromWorkBrief,
} from "@/lib/status/workDocumentation";
import { presentPeerQcPickerOptions } from "@/lib/jobs-v2/peerQcCompletion";
import {
  buildFloorActionModel,
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

function WorkDocumentationSheet({
  surface,
  itemId,
  action,
  pending,
  error,
}: {
  surface: FloorOsSurface;
  itemId: string;
  action: (payload: FormData) => void;
  pending: boolean;
  error: string | null;
}) {
  const documented = journalFromWorkBrief(surface.work_brief);
  const gate = evaluatePerformWorkDocumentation(documented);
  const hasLine = hasWrittenWorkLine(documented);
  const hasPhoto = hasWorkPhotoChoice(documented);
  if (!surface.job_id) return null;

  return (
    <>
      <h3 className="pit-sheet-title">Write it down</h3>
      <p className="pit-sheet-or">
        {gate.ok ? "This job already has a line and a photo." : gate.reason}
      </p>
      <form action={action} className="pit-sheet-form">
        <input type="hidden" name="job_id" value={surface.job_id} />
        <input type="hidden" name="work_order_id" value={surface.work_order_id} />
        <input type="hidden" name="item_id" value={itemId} />
        <label className="pit-sheet-label">
          {hasLine ? "Add another line" : "What did you find or do?"}
          <textarea
            name="note"
            className="pit-sheet-input"
            rows={3}
            required={!hasLine}
            placeholder={hasLine ? "Optional" : "What did you find or do?"}
          />
        </label>
        <FloorPhotoField
          hint="Camera or photo library"
          workOrderId={surface.work_order_id}
          jobId={surface.job_id}
          category="job_work"
        />
        {!hasPhoto ? (
          <button
            type="submit"
            formNoValidate
            name="nothing_to_photograph"
            value="true"
            className="pit-sheet-btn"
            disabled={pending}
          >
            Nothing to photograph
          </button>
        ) : null}
        <button
          type="submit"
          className="pit-current-action"
          disabled={pending || !hasPhoto}
        >
          Mark work done
        </button>
        {error ? (
          <p className="pit-photo-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </>
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

type Overlay =
  null | "park" | "fail" | "qc_pick" | "sign_qc" | "sign_safety" | "work_doc";

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
  "clear_tool",
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
  packetAssistant,
  packetDiagnostics = null,
  canRecordDiagnostics = false,
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
  packetAssistant?: AskOtomotoPanelData | null;
  packetDiagnostics?: DiagnosticPanelData | null;
  canRecordDiagnostics?: boolean;
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
  const [parkNote, setParkNote] = useState("");
  const [qcQuery, setQcQuery] = useState("");
  const [qcChecks, setQcChecks] = useState<boolean[]>([false, false, false]);
  const [note, setNote] = useState<string | null>(null);
  const [timerSecs, setTimerSecs] = useState(surface?.timer_secs ?? 0);
  const [, startTransition] = useTransition();
  const overlayRef = useRef(overlay);
  const seenFloorResults = useRef(new Set<FloorActionState>());
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
  const [parkState, parkAction, parkPending] = useActionState(
    async (prev: FloorActionState, formData: FormData) => {
      const result = await parkJobAction(prev, formData);
      if (result?.success) {
        setParkNote("");
        setOverlay(null);
      }
      return result;
    },
    null
  );
  const [resumeState, resumeAction, resumePending] = useActionState(
    resumeParkedJobAction,
    null
  );
  const [clearState, clearAction, clearPending] = useActionState(
    clearToolWaitAction,
    null
  );
  const [completeState, completeAction, completePending] = useActionState(
    completeJobFloorAction,
    null
  );
  const [toggleState, toggleAction] = useActionState(toggleChecklistAction, null);
  const [installState, installAction, _installPending] = useActionState(
    installPartFloorAction,
    null
  );
  const [skipState, skipAction, skipPending] = useActionState(skipProofAction, null);
  const [workState, workAction, workPending] = useActionState(
    async (prev: FloorActionState, formData: FormData) => {
      const result = await completePerformWorkAction(prev, formData);
      if (result?.success) setOverlay(null);
      return result;
    },
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
      return { success: "Safety check passed." };
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
      clearState,
      completeState,
      skipState,
      workState,
      passQcState,
      failQcState,
      passSafetyState,
    ];
    const fresh = states.filter((s): s is NonNullable<FloorActionState> =>
      Boolean(s && (s.success || s.error) && !seenFloorResults.current.has(s))
    );
    if (fresh.length === 0) return;
    for (const s of fresh) seenFloorResults.current.add(s);
    const incoming = fresh[fresh.length - 1];
    setNote(incoming.success ?? incoming.error ?? null);
    if (incoming.success) {
      setOverlay(null);
      startTransition(() => scheduleRefresh());
    }
  }, [
    ackState,
    pullState,
    parkState,
    resumeState,
    clearState,
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
    registerTechnicianNoteRealtime(
      channel,
      docketWoKey.length > 0 ? docketWoKey.split(",") : [],
      () => {
        scheduleRefresh();
      }
    );
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

  const benchItems = docketItems.filter((item) => item.board_status === "bench");
  const waitingItems = docketItems.filter((item) => item.board_status === "waiting");
  const lineItems = docketItems.filter(
    (item) => item.board_status !== "bench" && item.board_status !== "waiting"
  );
  const benchBikeLabel =
    benchItems[0]?.motorcycle_label ??
    (surface?.board_status === "bench" ? surface.motorcycle_label : null);

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
    clearPending ||
    completePending ||
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
        can_start: docketItems.find(
          (item) =>
            item.work_order_id === surface.work_order_id &&
            (item.kind === "now" || item.kind === "assigned")
        )?.can_start,
        pending_action: pending,
      })
    : null;
  const model = builtModel && previewMode ? applyPreviewLock(builtModel) : builtModel;
  const parkControl = model?.secondary.find((control) => control.action === "park");
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
    if (primary.action === "clear_tool" && surface.job_id) {
      dispatchFloorAction(clearAction, {
        job_id: surface.job_id,
        work_order_id: surface.work_order_id,
      });
      return;
    }
    if (primary.action === "complete" && surface.job_id) {
      setQcQuery("");
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
      requestMarkWorkDone();
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
      setQcQuery("");
      setOverlay("qc_pick");
    }
  }

  function requestMarkWorkDone() {
    if (!surface?.job_id || !openPerformWorkItemId) return;
    const documented = journalFromWorkBrief(surface.work_brief);
    if (evaluatePerformWorkDocumentation(documented).ok) {
      dispatchFloorAction(workAction, {
        job_id: surface.job_id,
        work_order_id: surface.work_order_id,
        item_id: openPerformWorkItemId,
      });
      return;
    }
    setOverlay("work_doc");
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

  const qcRoster = surface?.peer_qc_candidates ?? [];
  const qcChoices = presentPeerQcPickerOptions(qcRoster, qcQuery);

  const showPacket = panel === "packet";

  return (
    <div className="pit-shell">
      <header className="pit-topbar">
        <p className="pit-wordmark">OTOMOTO · TECH FLOOR</p>
        {previewMode ? (
          <p className="pit-preview-note" role="status">
            Owner preview — the technician&apos;s bench, timer, and final inspection
            controls are disabled.
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
            <section className="pit-rail-group" aria-label="On the bench">
              <h2 className="pit-rail-title">On the bench</h2>
              <p className="pit-rail-help">The bike with your running clock.</p>
              {benchItems.length > 0 ? (
                <TechnicianDocketList
                  items={benchItems}
                  selectedKey={selectedKey}
                  dnd={{ enabled: false }}
                />
              ) : (
                <p className="floor-muted">Bench is empty.</p>
              )}
            </section>
            <section className="pit-rail-group" aria-label="Your line">
              <h2 className="pit-rail-title">Your line</h2>
              <p className="pit-rail-help">
                Advisor order. Drag any assigned bike onto the bench. Starting another
                parks the one on the clock.
              </p>
              {lineItems.length > 0 ? (
                <TechnicianDocketList
                  items={lineItems}
                  selectedKey={selectedKey}
                  dnd={{
                    enabled: shopDndEnabled && !pending,
                    draggingKey,
                  }}
                />
              ) : (
                <p className="floor-muted">Nothing waiting in line.</p>
              )}
            </section>
            <section className="pit-rail-group" aria-label="Waiting">
              <h2 className="pit-rail-title">Waiting</h2>
              <p className="pit-rail-help">
                These bikes are out of the line until the wait is cleared.
              </p>
              {waitingItems.length > 0 ? (
                <TechnicianDocketList
                  items={waitingItems}
                  selectedKey={selectedKey}
                  dnd={{ enabled: false }}
                />
              ) : (
                <p className="floor-muted">No bikes waiting.</p>
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
                    assistant={packetAssistant ?? null}
                    diagnostics={packetDiagnostics}
                    canRecordDiagnostics={canRecordDiagnostics}
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
                      onCompleteWork={requestMarkWorkDone}
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
                      skipAction={skipAction}
                      skipPending={skipPending}
                      workPending={workPending}
                    />

                    {surface.can_safety && surface.checkout_evidence_required ? (
                      <CheckoutEvidencePanel
                        workOrderId={surface.work_order_id}
                        required
                        photos={surface.checkout_photos}
                        jobsComplete={surface.jobs_complete}
                        qcComplete={surface.qc_complete}
                        canUpload={!previewMode}
                        locked={false}
                        canOverride={false}
                      />
                    ) : null}

                    {surface.can_safety && !previewMode ? (
                      <div className="pit-safety-actions">
                        <button
                          type="button"
                          className="btn btn-primary pit-go"
                          onClick={() => setOverlay("sign_safety")}
                        >
                          Pass safety check ✓
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
                            value="Safety check failed on floor"
                          />
                          <button type="submit" className="btn btn-secondary">
                            Fail safety check
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>

                  <FloorDock
                    model={model}
                    parkControl={parkControl}
                    failQcControl={failQcControl}
                    onPark={() => setOverlay("park")}
                    onFailQc={() => setOverlay("fail")}
                    onGo={runGo}
                    message={
                      <ActionMessage
                        state={
                          pullState?.error
                            ? pullState
                            : ackState?.error
                              ? ackState
                              : clearState?.error
                                ? clearState
                                : completeState?.error
                                  ? completeState
                                  : toggleState?.error
                                    ? toggleState
                                    : installState?.error
                                      ? installState
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
                <label className="pit-sheet-label">
                  What&apos;s waiting?
                  <textarea
                    className="pit-sheet-input"
                    rows={3}
                    value={parkNote}
                    onChange={(event) => setParkNote(event.target.value)}
                    placeholder="What's waiting?"
                  />
                </label>
                <FloorPhotoField
                  hint="Optional photo of the problem"
                  workOrderId={surface.work_order_id}
                  jobId={surface.job_id}
                  category="job_work"
                />
                <p className="pit-sheet-or">Write one line, then pick why.</p>
                <div className="pit-sheet-grid">
                  {PARK_REASON_OPTIONS.map((opt) => (
                    <button
                      key={opt.reason}
                      type="button"
                      className="pit-sheet-btn"
                      disabled={parkPending || !parkNote.trim()}
                      onClick={() =>
                        dispatchFloorAction(parkAction, {
                          job_id: surface.job_id!,
                          work_order_id: surface.work_order_id,
                          reason: opt.reason,
                          note: parkNote.trim(),
                        })
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {parkState?.error ? (
                  <p className="pit-photo-error" role="alert">
                    {parkState.error}
                  </p>
                ) : null}
              </>
            ) : null}

            {overlay === "work_doc" && surface?.job_id && openPerformWorkItemId ? (
              <WorkDocumentationSheet
                surface={surface}
                itemId={openPerformWorkItemId}
                action={workAction}
                pending={workPending}
                error={workState?.error ?? null}
              />
            ) : null}

            {overlay === "qc_pick" && surface?.job_id ? (
              <>
                <h3 className="pit-sheet-title">Who should check your work?</h3>
                <p className="pit-sheet-or">
                  Find a tech who didn&apos;t work this bike. They get it for final
                  inspection.
                </p>
                {qcRoster.length > 0 ? (
                  <>
                    <label className="pit-sheet-label">
                      Find a tech
                      <input
                        type="search"
                        className="pit-sheet-input"
                        value={qcQuery}
                        placeholder="Name"
                        autoComplete="off"
                        enterKeyHint="search"
                        onChange={(event) => setQcQuery(event.target.value)}
                      />
                    </label>
                    {qcChoices.length > 0 ? (
                      <ul className="pit-sheet-list">
                        {qcChoices.map((tech) => (
                          <li key={tech.user_id}>
                            <button
                              type="button"
                              className="pit-sheet-btn"
                              disabled={completePending}
                              onClick={() => completeWithQcAssignee(tech.user_id)}
                            >
                              {tech.display_name}
                              {tech.clocked_in ? (
                                <span className="pit-sheet-btn-sub">On the clock</span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="pit-sheet-or">No tech matches that name.</p>
                    )}
                  </>
                ) : (
                  <p className="pit-sheet-or">
                    Everyone else already worked this bike. Front desk will cover final
                    inspection.
                  </p>
                )}
                {qcRoster.length === 0 ? (
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
                <h3 className="pit-sheet-title">Fail final inspection</h3>
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
                <h3 className="pit-sheet-title">Sign final inspection</h3>
                <p className="pit-sheet-or">
                  Draw your signature to vouch for this bike before the safety check.
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
                  <SignOffPad label="Final inspection signature" />
                  <button type="submit" className="pit-go" disabled={passQcPending}>
                    Pass final inspection — vouch for it ✓
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
                <h3 className="pit-sheet-title">Sign safety check</h3>
                <p className="pit-sheet-or">
                  Draw your signature to pass the safety check and clear the bike for
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
                  <SignOffPad label="Safety check signature" />
                  <button type="submit" className="pit-go" disabled={passSafetyPending}>
                    Pass safety check ✓
                  </button>
                </form>
                {passSafetyState?.error ? (
                  <p className="floor-dock-msg floor-dock-msg--error" role="status">
                    {passSafetyState.error}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
