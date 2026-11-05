/**
 * Technician floor queue.
 *
 * One bike on the bench (a running job clock). The advisor's docket order
 * is the line. A bike leaves that line only for a standard stop.
 */

import { workOrderStillOnTechnicianFloor } from "@/lib/technician/floorActionModel";

export type QueuePart = { status: string };

export type QueueService = {
  job_id: string;
  work_order_id: string;
  assigned_technician_id: string | null;
  status: string;
  docket_position: number | null;
  service_name?: string | null;
  parts?: readonly QueuePart[];
  /** This technician has an open job clock on this service. */
  timer_running?: boolean;
  /**
   * When set, a visit that has left the bay is ignored. Omitted keeps the
   * older callers, which already filtered those visits out.
   */
  work_order_status?: string | null;
};

export type QueueBlocker = {
  job_id: string;
  kind: string;
  opened_at: string;
};

export type ServiceBlockReason = "approval" | "parts";

export type QueueOwner = "front_desk" | "parts" | "technician";

export type QueueNote = {
  job_id: string;
  service_name: string | null;
  reason: ServiceBlockReason;
  owner: "front_desk" | "parts";
  opened_at: string | null;
};

export type FloorQueueBike = {
  work_order_id: string;
  /** Earliest advisor position on this bike. Nulls sort last. */
  position: number | null;
  lane: "bench" | "line" | "waiting";
  reason: "approval" | "parts" | "tool" | null;
  owner: QueueOwner | null;
  opened_at: string | null;
  notes: QueueNote[];
  /** Start is legal for this bike right now. */
  can_start: boolean;
};

export type FloorQueueDecision = {
  bench_work_order_id: string | null;
  bikes: FloorQueueBike[];
};

export type StartRefusal = "START_BENCH_OCCUPIED" | "START_NOT_NEXT" | "START_WAITING";

export type ClockAction = {
  technician_id: string;
  action: "keep" | "switch" | "stop";
  job_id: string | null;
};

export type BlockerChange = {
  job_id: string;
  kind: ServiceBlockReason;
  owner: "front_desk" | "parts";
};

export type FloorSyncPlan = {
  open: BlockerChange[];
  close: Array<{ job_id: string; kind: ServiceBlockReason }>;
  clocks: ClockAction[];
};

const WORKABLE_STATUSES = new Set(["approved", "ready_to_start", "in_progress"]);
/**
 * Statuses a technician may clock even while parts are missing.
 * Customer approval is not one of them.
 */
const TECHNICIAN_WORK_STATUSES = new Set([
  "approved",
  "ready_to_start",
  "in_progress",
  "waiting_for_parts",
]);
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "declined", "draft"]);

export function isBlockingPartStatus(status: string): boolean {
  return status === "needed" || status === "ordered";
}

export function isWorkableService(input: {
  status: string;
  parts?: readonly QueuePart[];
}): boolean {
  if (!WORKABLE_STATUSES.has(input.status)) return false;
  return !(input.parts ?? []).some((part) => isBlockingPartStatus(part.status));
}

/** The technician can wrench this service. Missing parts do not stop the clock. */
export function isTechnicianWorkableService(input: { status: string }): boolean {
  return TECHNICIAN_WORK_STATUSES.has(input.status);
}

/** The standard parts or approval stop for one service, when it cannot be worked. */
export function serviceBlock(input: {
  status: string;
  parts?: readonly QueuePart[];
}): { reason: ServiceBlockReason; owner: "front_desk" | "parts" } | null {
  if (isWorkableService(input) || TERMINAL_STATUSES.has(input.status)) return null;
  if (input.status === "waiting_for_approval") {
    return { reason: "approval", owner: "front_desk" };
  }
  if (
    input.status === "waiting_for_parts" ||
    (input.parts ?? []).some((part) => isBlockingPartStatus(part.status))
  ) {
    return { reason: "parts", owner: "parts" };
  }
  return null;
}

function positionOf(services: readonly QueueService[]): number | null {
  let best: number | null = null;
  for (const service of services) {
    if (service.docket_position == null) continue;
    if (best == null || service.docket_position < best) best = service.docket_position;
  }
  return best;
}

function comparePosition(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function earliestOpened(
  blockers: readonly QueueBlocker[],
  jobIds: ReadonlySet<string>,
  kind: string
): string | null {
  let earliest: string | null = null;
  for (const blocker of blockers) {
    if (blocker.kind !== kind || !jobIds.has(blocker.job_id)) continue;
    if (earliest == null || blocker.opened_at < earliest) earliest = blocker.opened_at;
  }
  return earliest;
}

function noteFor(
  service: QueueService,
  blockers: readonly QueueBlocker[]
): QueueNote | null {
  const block = serviceBlock(service);
  if (!block) return null;
  return {
    job_id: service.job_id,
    service_name: service.service_name ?? null,
    reason: block.reason,
    owner: block.owner,
    opened_at: earliestOpened(blockers, new Set([service.job_id]), block.reason),
  };
}

export function decideFloorQueue(input: {
  technician_id: string;
  services: readonly QueueService[];
  blockers?: readonly QueueBlocker[];
}): FloorQueueDecision {
  const blockers = input.blockers ?? [];
  const mine = input.services.filter(
    (service) =>
      service.assigned_technician_id === input.technician_id &&
      workOrderStillOnTechnicianFloor(service.work_order_status)
  );
  const byBike = new Map<string, QueueService[]>();
  for (const service of mine) {
    if (TERMINAL_STATUSES.has(service.status)) continue;
    const group = byBike.get(service.work_order_id);
    if (group) group.push(service);
    else byBike.set(service.work_order_id, [service]);
  }

  const bikes: FloorQueueBike[] = [];
  for (const [workOrderId, services] of byBike) {
    const jobIds = new Set(services.map((service) => service.job_id));
    const toolOpened = earliestOpened(blockers, jobIds, "tool");
    const notes = services
      .map((service) => noteFor(service, blockers))
      .filter((note): note is QueueNote => note != null);
    const workable = services.some((service) => isTechnicianWorkableService(service));
    const position = positionOf(services);
    const timerOnBike = services.some((service) => service.timer_running);

    let lane: FloorQueueBike["lane"] = "line";
    let reason: FloorQueueBike["reason"] = null;
    let owner: FloorQueueBike["owner"] = null;
    let opened_at: string | null = null;

    if (toolOpened) {
      lane = "waiting";
      reason = "tool";
      owner = "technician";
      opened_at = toolOpened;
    } else if (!workable && notes.some((note) => note.reason === "approval")) {
      // Parts never take the bike out of the line. The tech keeps working,
      // and the missing parts stay as a note.
      lane = "waiting";
      reason = "approval";
      owner = "front_desk";
      opened_at = earliestOpened(blockers, jobIds, "approval");
    } else if (timerOnBike) {
      lane = "bench";
    }

    bikes.push({
      work_order_id: workOrderId,
      position,
      lane,
      reason,
      owner,
      opened_at,
      notes: lane === "waiting" && reason !== "tool" ? [] : notes,
      can_start: false,
    });
  }

  bikes.sort((a, b) => comparePosition(a.position, b.position));
  const bench = bikes.find((bike) => bike.lane === "bench") ?? null;
  const line = bikes.filter((bike) => bike.lane === "line");
  if (!bench && line[0]) line[0].can_start = true;

  return {
    bench_work_order_id: bench?.work_order_id ?? null,
    bikes,
  };
}

export function startRefusal(
  decision: FloorQueueDecision,
  workOrderId: string
): StartRefusal | null {
  const bike = decision.bikes.find((row) => row.work_order_id === workOrderId);
  if (!bike) return "START_NOT_NEXT";
  if (bike.lane === "waiting") return "START_WAITING";
  if (bike.lane === "bench") return null;
  if (decision.bench_work_order_id && decision.bench_work_order_id !== workOrderId) {
    return "START_BENCH_OCCUPIED";
  }
  if (!bike.can_start) return "START_NOT_NEXT";
  return null;
}

export function planTechnicianClock(input: {
  technician_id: string;
  services: readonly QueueService[];
  blockers?: readonly QueueBlocker[];
}): ClockAction {
  const blockers = input.blockers ?? [];
  const mine = input.services.filter(
    (service) => service.assigned_technician_id === input.technician_id
  );
  const running = mine.find((service) => service.timer_running);
  if (!running) {
    return { technician_id: input.technician_id, action: "keep", job_id: null };
  }
  const bike = mine.filter((service) => service.work_order_id === running.work_order_id);
  const jobIds = new Set(bike.map((service) => service.job_id));
  if (earliestOpened(blockers, jobIds, "tool")) {
    return { technician_id: input.technician_id, action: "stop", job_id: null };
  }
  if (isTechnicianWorkableService(running)) {
    return {
      technician_id: input.technician_id,
      action: "keep",
      job_id: running.job_id,
    };
  }
  const next = bike
    .filter((service) => isTechnicianWorkableService(service))
    .sort((a, b) => comparePosition(a.docket_position, b.docket_position))[0];
  if (next) {
    return { technician_id: input.technician_id, action: "switch", job_id: next.job_id };
  }
  return { technician_id: input.technician_id, action: "stop", job_id: null };
}

/**
 * Blocker opens and closes implied by the current jobs and parts.
 * Tool blockers are left untouched. An already-open parts or approval
 * blocker is not opened again.
 */
export function planFloorSync(input: {
  services: readonly QueueService[];
  blockers?: readonly QueueBlocker[];
}): FloorSyncPlan {
  const blockers = input.blockers ?? [];
  const open: BlockerChange[] = [];
  const close: Array<{ job_id: string; kind: ServiceBlockReason }> = [];

  for (const service of input.services) {
    const desired = serviceBlock(service);
    for (const kind of ["approval", "parts"] as const) {
      const existing = blockers.some(
        (blocker) => blocker.job_id === service.job_id && blocker.kind === kind
      );
      if (desired?.reason === kind) {
        if (!existing) {
          open.push({ job_id: service.job_id, kind, owner: desired.owner });
        }
      } else if (existing) {
        close.push({ job_id: service.job_id, kind });
      }
    }
  }

  const technicianIds = [
    ...new Set(
      input.services
        .map((service) => service.assigned_technician_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const clocks = technicianIds.map((technician_id) =>
    planTechnicianClock({
      technician_id,
      services: input.services,
      blockers,
    })
  );

  return { open, close, clocks };
}

export function waitReasonLabel(reason: FloorQueueBike["reason"]): string {
  switch (reason) {
    case "approval":
      return "Waiting for customer OK";
    case "parts":
      return "Waiting for parts";
    case "tool":
      return "Tool or lift busy";
    default:
      return "";
  }
}

export function queueNoteLabel(note: QueueNote): string {
  const name = note.service_name?.trim() || "Service";
  const why = note.reason === "approval" ? "waiting on the customer" : "waiting on parts";
  return `${name} — ${why}`;
}

/** Short age for a Waiting card. Empty when the open time is missing. */
export function formatWaitAge(openedAt: string | null, nowMs = Date.now()): string {
  if (!openedAt) return "";
  const start = new Date(openedAt).getTime();
  if (Number.isNaN(start)) return "";
  const minutes = Math.max(0, Math.floor((nowMs - start) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.floor(hours / 24);
  const hourRest = hours % 24;
  return hourRest === 0 ? `${days}d` : `${days}d ${hourRest}h`;
}
