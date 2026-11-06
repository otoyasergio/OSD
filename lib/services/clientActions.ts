import { requireUser, type AppUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import {
  CLIENT_ACTION_REASONS,
  chooseVisitPhotoPath,
  composeStaffSms,
  decideClientActions,
  reminderSnoozeUntil,
  isClientActionOilService,
  type ClientActionCard,
  type ClientActionCustomer,
  type ClientActionMotorcycle,
  type ClientActionReason,
  type ClientActionResolution,
  type ClientActionVisit,
} from "@/lib/actions/clientActions";
import { clientDisplayName } from "@/lib/customers/displayName";
import type { DbClient, WorkOrderStatus } from "@/lib/database/types";
import { signStoragePaths } from "@/lib/photos/signedUrls";
import { shopDateKey } from "@/lib/datetime/format";
import { canEditWorkOrder } from "@/lib/permissions";
import { normalizePhoneE164 } from "@/lib/phone/e164";
import { logger } from "@/lib/security/logger";
import { sendCustomerSms } from "@/lib/services/customerSms";
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";

const STAFF_SMS_MAX = 900;
const PAGE_SIZE = 1000;
const ID_CHUNK = 150;

export type ClientActionListItem = ClientActionCard & {
  customerName: string;
  bikeLabel: string | null;
  workOrderNumber: string | null;
  photoUrl: string | null;
};

type CustomerRow = {
  customer_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  sms_opted_out_at: string | null;
  wix_contact_id: string | null;
  date_of_birth: string | null;
};

type MotorcycleRow = {
  motorcycle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
};

type WorkOrderRow = {
  work_order_id: string;
  work_order_number: string | null;
  status: string;
  opened_at: string | null;
  created_at: string;
  ready_for_pickup_at: string | null;
  customer_id: string | null;
  motorcycle_id: string | null;
  customer: CustomerRow | CustomerRow[] | null;
  motorcycle: MotorcycleRow | MotorcycleRow[] | null;
};

type CompletedRow = {
  work_order_id: string;
  motorcycle_id: string | null;
  customer_id: string | null;
  completed_at: string | null;
};

type LogRow = {
  work_order_id: string | null;
  direction: string;
  channel: string;
  template_key: string | null;
  status: string;
  created_at: string;
};

type TimelineRow = {
  work_order_id: string;
  created_at: string;
  new_value: { status?: string } | null;
};

type OilJobRow = {
  service_name_snapshot: string;
  work_order:
    | {
        motorcycle_id: string | null;
        completed_at: string | null;
      }
    | Array<{
        motorcycle_id: string | null;
        completed_at: string | null;
      }>
    | null;
};

type Board = {
  items: ClientActionListItem[];
  customers: Map<string, CustomerRow>;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function later(left: string | null, right: string): string {
  if (!left) return right;
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (!Number.isFinite(a)) return right;
  if (!Number.isFinite(b)) return left;
  return b >= a ? right : left;
}

function atOrAfter(value: string, threshold: string): boolean {
  const left = Date.parse(value);
  const right = Date.parse(threshold);
  return Number.isFinite(left) && Number.isFinite(right) && left >= right;
}

function bikeLabel(motorcycle: MotorcycleRow | null): string | null {
  if (!motorcycle) return null;
  const label = [motorcycle.year, motorcycle.make, motorcycle.model]
    .filter((part) => part != null && String(part).trim() !== "")
    .join(" ");
  return label || null;
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

async function eachPage<T>(
  load: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await load(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

function isReason(value: string): value is ClientActionReason {
  return (CLIENT_ACTION_REASONS as readonly string[]).includes(value);
}

async function loadBoard(user: AppUser): Promise<Board> {
  if (!canEditWorkOrder(user.role)) throw new Error("FORBIDDEN");
  const locationId = user.active_location_id!;
  const supabase = await createClient();

  const openOrders = await eachPage<WorkOrderRow>((from, to) =>
    supabase
      .from("work_order")
      .select(
        `
        work_order_id, work_order_number, status, opened_at, created_at, ready_for_pickup_at,
        customer_id, motorcycle_id,
        customer:customer_id ( customer_id, first_name, last_name, phone, sms_opted_out_at, wix_contact_id, date_of_birth ),
        motorcycle:motorcycle_id ( motorcycle_id, year, make, model )
      `
      )
      .eq("location_id", locationId)
      .not("status", "in", '("draft","completed","cancelled")')
      .order("work_order_id")
      .range(from, to)
  );

  const openIds = openOrders.map((row) => row.work_order_id);
  const [recommendations, logs, timeline, resolutions, completed, oilJobs] =
    await Promise.all([
      openIds.length === 0
        ? Promise.resolve(
            [] as Array<{ recommendation_id: string; work_order_id: string }>
          )
        : eachPage<{ recommendation_id: string; work_order_id: string }>((from, to) =>
            supabase
              .from("recommendation")
              .select("recommendation_id, work_order_id")
              .in("work_order_id", openIds)
              .eq("status", "pending")
              .order("recommendation_id")
              .range(from, to)
          ),
      openIds.length === 0
        ? Promise.resolve([] as LogRow[])
        : eachPage<LogRow>((from, to) =>
            supabase
              .from("communication_log")
              .select(
                "work_order_id, direction, channel, template_key, status, created_at"
              )
              .in("work_order_id", openIds)
              .order("log_id")
              .range(from, to)
          ),
      openIds.length === 0
        ? Promise.resolve([] as TimelineRow[])
        : eachPage<TimelineRow>((from, to) =>
            supabase
              .from("timeline_event")
              .select("work_order_id, created_at, new_value")
              .in("work_order_id", openIds)
              .eq("event_type", TimelineEventType.WORK_ORDER_STATUS_CHANGED)
              .order("timeline_event_id")
              .range(from, to)
          ),
      eachPage<{
        reason: string;
        cycle_key: string;
        outcome: string;
        snooze_until: string | null;
      }>((from, to) =>
        supabase
          .from("client_action_resolution")
          .select("reason, cycle_key, outcome, snooze_until")
          .eq("location_id", locationId)
          .order("resolution_id")
          .range(from, to)
      ),
      eachPage<CompletedRow>((from, to) =>
        supabase
          .from("work_order")
          .select("work_order_id, motorcycle_id, customer_id, completed_at")
          .eq("location_id", locationId)
          .eq("status", "completed")
          .not("completed_at", "is", null)
          .order("work_order_id")
          .range(from, to)
      ),
      eachPage<OilJobRow>((from, to) =>
        supabase
          .from("job")
          .select(
            "service_name_snapshot, work_order:work_order_id!inner(motorcycle_id, completed_at, location_id, status)"
          )
          .eq("status", "completed")
          .eq("work_order.location_id", locationId)
          .eq("work_order.status", "completed")
          .or(
            "service_name_snapshot.ilike.*oil change*,service_name_snapshot.ilike.*tune up*"
          )
          .order("job_id")
          .range(from, to)
      ),
    ]);

  const pendingByWorkOrder = new Map<string, string[]>();
  for (const recommendation of recommendations) {
    const list = pendingByWorkOrder.get(recommendation.work_order_id) ?? [];
    list.push(recommendation.recommendation_id);
    pendingByWorkOrder.set(recommendation.work_order_id, list);
  }

  const latestLog = new Map<string, LogRow>();
  const latestInbound = new Map<string, string>();
  for (const log of logs) {
    if (!log.work_order_id) continue;
    const current = latestLog.get(log.work_order_id);
    if (!current || atOrAfter(log.created_at, current.created_at)) {
      latestLog.set(log.work_order_id, log);
    }
    if (log.direction === "inbound") {
      latestInbound.set(
        log.work_order_id,
        later(latestInbound.get(log.work_order_id) ?? null, log.created_at)
      );
    }
  }

  const partsEntered = new Map<string, string>();
  for (const event of timeline) {
    if (event.new_value?.status !== "waiting_for_parts") continue;
    partsEntered.set(
      event.work_order_id,
      later(partsEntered.get(event.work_order_id) ?? null, event.created_at)
    );
  }

  const latestCompleted = new Map<string, CompletedRow>();
  const completedCustomerIds = new Set<string>();
  for (const row of completed) {
    if (!row.motorcycle_id || !row.customer_id || !row.completed_at) continue;
    completedCustomerIds.add(row.customer_id);
    const current = latestCompleted.get(row.motorcycle_id);
    if (!current?.completed_at || atOrAfter(row.completed_at, current.completed_at)) {
      latestCompleted.set(row.motorcycle_id, row);
    }
  }

  const latestOil = new Map<string, string>();
  for (const job of oilJobs) {
    if (!isClientActionOilService(job.service_name_snapshot)) continue;
    const workOrder = one(job.work_order);
    if (!workOrder?.motorcycle_id || !workOrder.completed_at) continue;
    latestOil.set(
      workOrder.motorcycle_id,
      later(latestOil.get(workOrder.motorcycle_id) ?? null, workOrder.completed_at)
    );
  }

  const customers = new Map<string, CustomerRow>();
  const motorcycles = new Map<string, MotorcycleRow>();
  for (const order of openOrders) {
    const customer = one(order.customer);
    const motorcycle = one(order.motorcycle);
    if (customer) customers.set(customer.customer_id, customer);
    if (motorcycle) motorcycles.set(motorcycle.motorcycle_id, motorcycle);
  }

  const historyCustomerIds = [...completedCustomerIds].filter((id) => !customers.has(id));
  const historyMotorcycleIds = [...latestCompleted.keys()].filter(
    (id) => !motorcycles.has(id)
  );
  const [historyCustomers, historyMotorcycles] = await Promise.all([
    loadCustomers(supabase, historyCustomerIds),
    loadMotorcycles(supabase, historyMotorcycleIds),
  ]);
  for (const customer of historyCustomers) customers.set(customer.customer_id, customer);
  for (const motorcycle of historyMotorcycles) {
    motorcycles.set(motorcycle.motorcycle_id, motorcycle);
  }

  const visits: ClientActionVisit[] = [];
  const workOrders = new Map<string, WorkOrderRow>();
  for (const order of openOrders) {
    if (!order.customer_id || !order.motorcycle_id) continue;
    workOrders.set(order.work_order_id, order);
    const latest = latestLog.get(order.work_order_id);
    const direction =
      latest?.direction === "inbound" || latest?.direction === "outbound"
        ? latest.direction
        : null;
    const pickupSmsLoggedAfterReady = logs.some(
      (log) =>
        log.work_order_id === order.work_order_id &&
        log.channel === "sms" &&
        log.direction === "outbound" &&
        log.template_key === "ready_for_pickup" &&
        log.status === "sent" &&
        order.ready_for_pickup_at != null &&
        atOrAfter(log.created_at, order.ready_for_pickup_at)
    );
    visits.push({
      workOrderId: order.work_order_id,
      customerId: order.customer_id,
      motorcycleId: order.motorcycle_id,
      status: order.status as WorkOrderStatus,
      openedAt: order.opened_at,
      createdAt: order.created_at,
      readyForPickupAt: order.ready_for_pickup_at,
      latestMessageDirection: direction,
      latestInboundAt: latestInbound.get(order.work_order_id) ?? null,
      pendingRecommendationIds: pendingByWorkOrder.get(order.work_order_id) ?? [],
      partsEnteredAt: partsEntered.get(order.work_order_id) ?? null,
      pickupSmsLoggedAfterReady,
    });
  }

  const motorcycleFacts: ClientActionMotorcycle[] = [...latestCompleted.values()].map(
    (row) => ({
      motorcycleId: row.motorcycle_id!,
      customerId: row.customer_id!,
      lastCompletedAt: row.completed_at,
      lastOilAt: latestOil.get(row.motorcycle_id!) ?? null,
    })
  );

  const customerFacts: ClientActionCustomer[] = [...customers.values()].map((row) => ({
    customerId: row.customer_id,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    smsOptedOut: row.sms_opted_out_at != null,
    hasCompletedVisit: completedCustomerIds.has(row.customer_id),
  }));

  const resolutionFacts: ClientActionResolution[] = [];
  for (const row of resolutions) {
    if (!isReason(row.reason)) continue;
    if (row.outcome !== "sent" && row.outcome !== "dismissed") continue;
    resolutionFacts.push({
      reason: row.reason,
      cycleKey: row.cycle_key,
      outcome: row.outcome,
      snoozeUntil: row.snooze_until,
    });
  }

  const cards = decideClientActions({
    now: new Date().toISOString(),
    visits,
    motorcycles: motorcycleFacts,
    customers: customerFacts,
    resolutions: resolutionFacts,
  });

  const photoUrls = await loadVisitPhotoUrls(
    supabase,
    cards.flatMap((card) => (card.workOrderId ? [card.workOrderId] : []))
  );

  const items = cards.map((card) => {
    const order = card.workOrderId ? workOrders.get(card.workOrderId) : undefined;
    const motorcycleId = card.motorcycleId ?? order?.motorcycle_id ?? null;
    return {
      ...card,
      customerName: clientDisplayName(customers.get(card.customerId)) ?? "Customer",
      bikeLabel: bikeLabel(motorcycleId ? (motorcycles.get(motorcycleId) ?? null) : null),
      workOrderNumber: order?.work_order_number ?? null,
      photoUrl: card.workOrderId ? (photoUrls.get(card.workOrderId) ?? null) : null,
    };
  });

  return { items, customers };
}

/** Front intake photo, or the left side when the front was not taken. */
async function loadVisitPhotoUrls(
  supabase: DbClient,
  workOrderIds: string[]
): Promise<Map<string, string>> {
  const rows: Array<{ workOrderId: string; category: string; path: string | null }> = [];
  for (const chunk of chunks(workOrderIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("intake_photo")
      .select("work_order_id, category, storage_path, thumb_storage_path, created_at")
      .in("work_order_id", chunk)
      .in("category", ["front", "left_side"])
      .order("created_at", { ascending: false });
    if (error) throw error;
    for (const row of data ?? []) {
      if (!row.work_order_id || !row.category) continue;
      rows.push({
        workOrderId: row.work_order_id as string,
        category: row.category as string,
        path: ((row.thumb_storage_path || row.storage_path) as string | null) ?? null,
      });
    }
  }

  const chosen = chooseVisitPhotoPath(rows);
  const signed = await signStoragePaths(supabase, [...chosen.values()]);
  const urls = new Map<string, string>();
  for (const [workOrderId, path] of chosen) {
    const url = signed.get(path);
    if (url) urls.set(workOrderId, url);
  }
  return urls;
}

async function loadCustomers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<CustomerRow[]> {
  const rows: CustomerRow[] = [];
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("customer")
      .select(
        "customer_id, first_name, last_name, phone, sms_opted_out_at, wix_contact_id, date_of_birth"
      )
      .in("customer_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as CustomerRow[]));
  }
  return rows;
}

async function loadMotorcycles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<MotorcycleRow[]> {
  const rows: MotorcycleRow[] = [];
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("motorcycle")
      .select("motorcycle_id, year, make, model")
      .in("motorcycle_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as MotorcycleRow[]));
  }
  return rows;
}

export async function listClientActions(): Promise<ClientActionListItem[]> {
  const user = await requireUser();
  const board = await loadBoard(user);
  return board.items;
}

async function findOpenCard(
  user: AppUser,
  reason: string,
  cycleKey: string
): Promise<{ user: AppUser; item: ClientActionListItem; customer: CustomerRow }> {
  if (!isReason(reason)) throw new Error("CLIENT_ACTION_NOT_OPEN");
  const board = await loadBoard(user);
  const item = board.items.find(
    (card) => card.reason === reason && card.cycleKey === cycleKey
  );
  if (!item) throw new Error("CLIENT_ACTION_NOT_OPEN");
  const customer = board.customers.get(item.customerId);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  return { user, item, customer };
}

async function recordResolution(input: {
  user: AppUser;
  item: ClientActionListItem;
  outcome: "sent" | "dismissed";
  snoozeUntil: string | null;
  communicationLogId: string | null;
}): Promise<void> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("client_action_resolution").upsert(
    {
      location_id: input.user.active_location_id,
      customer_id: input.item.customerId,
      motorcycle_id: input.item.motorcycleId,
      work_order_id: input.item.workOrderId,
      reason: input.item.reason,
      cycle_key: input.item.cycleKey,
      outcome: input.outcome,
      snooze_until: input.snoozeUntil,
      communication_log_id: input.communicationLogId,
      acted_by_user_id: input.user.user_id,
      updated_at: now,
    },
    { onConflict: "location_id,reason,cycle_key" }
  );
  if (error) throw error;
}

export async function sendClientActionSms(input: {
  reason: string;
  cycleKey: string;
  body: string;
}): Promise<void> {
  const user = await requireUser();
  const staffText = input.body.trim();
  if (!staffText) throw new Error("CLIENT_ACTION_MESSAGE_REQUIRED");
  if (staffText.length > STAFF_SMS_MAX) throw new Error("CLIENT_ACTION_MESSAGE_TOO_LONG");
  const body = composeStaffSms(staffText);
  if (!body) throw new Error("CLIENT_ACTION_MESSAGE_REQUIRED");

  const { item, customer } = await findOpenCard(user, input.reason, input.cycleKey);
  if (item.smsBlock) throw new Error("CLIENT_ACTION_SMS_UNAVAILABLE");
  const toAddress = normalizePhoneE164(customer.phone);
  if (!toAddress) throw new Error("INVALID_PHONE");

  const admin = createAdminClient();
  const { data: queuedLog, error: queueError } = await admin
    .from("communication_log")
    .insert({
      work_order_id: item.workOrderId,
      customer_id: customer.customer_id,
      channel: "sms",
      direction: "outbound",
      template_key: null,
      to_address: toAddress,
      body,
      status: "queued",
      external_id: null,
      from_address: TORONTO_SHOP.phoneE164,
      error_message: null,
      dedupe_key: null,
      sent_by_user_id: user.user_id,
    })
    .select("log_id")
    .single();
  if (queueError) throw queueError;
  const logId = String(queuedLog.log_id);

  let externalId: string;
  try {
    externalId = await sendCustomerSms({
      customerId: customer.customer_id,
      wixContactId: customer.wix_contact_id,
      to: customer.phone,
      body,
      localOptedOutAt: customer.sms_opted_out_at,
    });
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "SEND_FAILED";
    const uncertain = errorCode === "WIX_INBOX_SEND_UNCERTAIN";
    await admin
      .from("communication_log")
      .update({
        status: uncertain ? "queued" : "failed",
        error_message: errorCode,
      })
      .eq("log_id", logId);
    throw error;
  }

  const { error: sentError } = await admin
    .from("communication_log")
    .update({
      status: "sent",
      external_id: externalId,
      error_message: null,
    })
    .eq("log_id", logId);
  if (sentError) throw sentError;

  await recordResolution({
    user,
    item,
    outcome: "sent",
    snoozeUntil: null,
    communicationLogId: logId,
  });

  if (item.workOrderId) {
    try {
      const supabase = await createClient();
      await addTimelineEvent(supabase, {
        work_order_id: item.workOrderId,
        user_id: user.user_id,
        event_type: TimelineEventType.MESSAGE_SENT,
        entity_type: "communication_log",
        entity_id: logId,
        description: `SMS sent (${item.reason})`,
        new_value: { channel: "sms", reason: item.reason },
      });
    } catch (timelineError) {
      logger.warn("Client action timeline write failed", {
        logId,
        workOrderId: item.workOrderId,
        error: timelineError instanceof Error ? timelineError.message : "TIMELINE_FAILED",
      });
    }
  }
}

export async function dismissClientAction(input: {
  reason: string;
  cycleKey: string;
}): Promise<void> {
  const user = await requireUser();
  const { item } = await findOpenCard(user, input.reason, input.cycleKey);
  const reminder =
    item.reason === "annual" || item.reason === "oil" || item.reason === "birthday";
  await recordResolution({
    user,
    item,
    outcome: "dismissed",
    snoozeUntil: reminder ? reminderSnoozeUntil(shopDateKey(new Date())) : null,
    communicationLogId: null,
  });
}
