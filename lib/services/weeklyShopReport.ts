import "server-only";

import { createAdminClient } from "@/lib/database/supabase-admin";
import { getFridayShopReportWindow } from "@/lib/datetime/format";
import { getShopMailbox } from "@/lib/email/mailbox";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { PARTS_WAITING_STATUSES, type PunchInput } from "@/lib/reports/shopMetrics";
import {
  WEEKLY_REPORT_NOTE_EVENTS,
  WEEKLY_SHOP_REPORT_TEMPLATE,
  WEEKLY_SHOP_REPORT_TO,
  buildWeeklyShopReport,
  renderWeeklyShopReport,
  runWeeklyShopReport,
  weeklyReportDedupeKey,
  type WeeklyJobInput,
  type WeeklyShopReportInput,
  type WeeklyTimelineInput,
  type WeeklyWorkOrderInput,
} from "@/lib/reports/weeklyShopReport";
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import { TimelineEventType } from "@/lib/timeline/events";

const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const ROW_LIMIT = 2000;

const WORK_ORDER_SELECT = `
  work_order_id,
  work_order_number,
  status,
  created_at,
  completed_at,
  billing_collected_cents,
  motorcycle:motorcycle_id ( year, make, model ),
  customer:customer_id ( first_name, last_name )
`;

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

export async function sendWeeklyShopReport(now = new Date()) {
  const admin = createAdminClient();
  const locationId = await loadTorontoLocationId(admin);
  if (!(await isEmailConfigured(locationId))) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
  const mailbox = await getShopMailbox(locationId);
  if (!mailbox) throw new Error("EMAIL_NOT_CONFIGURED");

  return runWeeklyShopReport({
    prepare: async () => {
      const input = await loadWeeklyShopReportInput(admin, locationId, now);
      const report = buildWeeklyShopReport(input);
      return {
        ...renderWeeklyShopReport(report),
        dedupeKey: weeklyReportDedupeKey(TORONTO_SHOP.locationCode, report.current),
      };
    },
    claim: (dedupeKey, text) =>
      claimWeeklyReportSend(admin, {
        dedupeKey,
        text,
        fromAddress: mailbox.emailAddress,
      }),
    send: (message) =>
      sendEmail({
        to: WEEKLY_SHOP_REPORT_TO,
        subject: message.subject,
        html: message.html,
        text: message.text,
        locationId,
      }),
    markSent: async (dedupeKey, messageId) => {
      const { error } = await admin
        .from("communication_log")
        .update({ status: "sent", external_id: messageId, error_message: null })
        .eq("template_key", WEEKLY_SHOP_REPORT_TEMPLATE)
        .eq("dedupe_key", dedupeKey);
      if (error) throw error;
    },
    release: async (dedupeKey) => {
      const { error } = await admin
        .from("communication_log")
        .delete()
        .eq("template_key", WEEKLY_SHOP_REPORT_TEMPLATE)
        .eq("dedupe_key", dedupeKey)
        .eq("status", "queued");
      if (error) throw error;
    },
  });
}

async function loadTorontoLocationId(admin: Admin): Promise<string> {
  const { data, error } = await admin
    .from("location")
    .select("location_id, status")
    .eq("code", TORONTO_SHOP.locationCode)
    .maybeSingle();
  if (error) throw error;
  const row = data as { location_id?: string; status?: string } | null;
  if (!row?.location_id || row.status !== "active") {
    throw new Error("WEEKLY_REPORT_LOCATION_MISSING");
  }
  return row.location_id;
}

async function claimWeeklyReportSend(
  admin: Admin,
  input: { dedupeKey: string; text: string; fromAddress: string }
): Promise<"claimed" | "duplicate"> {
  const { error } = await admin.from("communication_log").insert({
    work_order_id: null,
    customer_id: null,
    channel: "email",
    direction: "outbound",
    template_key: WEEKLY_SHOP_REPORT_TEMPLATE,
    to_address: WEEKLY_SHOP_REPORT_TO,
    from_address: input.fromAddress,
    body: input.text,
    status: "queued",
    dedupe_key: input.dedupeKey,
  });
  if (!error) return "claimed";
  if (error.code === "23505") return "duplicate";
  throw error;
}

async function loadWeeklyShopReportInput(
  admin: Admin,
  locationId: string,
  now: Date
): Promise<WeeklyShopReportInput> {
  const window = getFridayShopReportWindow(now);
  const previousStart = window.previous.startUtc.toISOString();
  const currentEnd = window.current.endUtc.toISOString();
  const lookback = new Date(
    window.previous.startUtc.getTime() - LOOKBACK_MS
  ).toISOString();

  const [openRows, createdRows, completedRows, cancelEvents] = await Promise.all([
    queryRows(
      admin
        .from("work_order")
        .select(WORK_ORDER_SELECT)
        .eq("location_id", locationId)
        .not("status", "in", '("completed","cancelled")')
        .lte("created_at", currentEnd)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("work_order")
        .select(WORK_ORDER_SELECT)
        .eq("location_id", locationId)
        .gte("created_at", previousStart)
        .lte("created_at", currentEnd)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("work_order")
        .select(WORK_ORDER_SELECT)
        .eq("location_id", locationId)
        .gte("completed_at", previousStart)
        .lte("completed_at", currentEnd)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("timeline_event")
        .select("work_order_id, created_at, work_order!inner(location_id)")
        .eq("work_order.location_id", locationId)
        .eq("event_type", TimelineEventType.WORK_ORDER_CANCELLED)
        .gte("created_at", previousStart)
        .lte("created_at", currentEnd)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT)
    ),
  ]);
  const cancelledAt = latestCancellation(cancelEvents);

  const jobSelect =
    "job_id, work_order_id, service_name_snapshot, completed_at, approved_by_customer_at, declined_at, work_order!inner(location_id)";
  const [
    cancelledRows,
    completedJobs,
    approvedJobs,
    declinedJobs,
    inspections,
    clock,
    jobTime,
    parts,
    timeline,
  ] = await Promise.all([
    cancelledAt.size === 0
      ? Promise.resolve([] as Row[])
      : queryRows(
          admin
            .from("work_order")
            .select(WORK_ORDER_SELECT)
            .eq("location_id", locationId)
            .in("work_order_id", [...cancelledAt.keys()])
            .limit(ROW_LIMIT)
        ),
    queryRows(
      admin
        .from("job")
        .select(jobSelect)
        .eq("work_order.location_id", locationId)
        .gte("completed_at", previousStart)
        .lte("completed_at", currentEnd)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("job")
        .select(jobSelect)
        .eq("work_order.location_id", locationId)
        .gte("approved_by_customer_at", previousStart)
        .lte("approved_by_customer_at", currentEnd)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("job")
        .select(jobSelect)
        .eq("work_order.location_id", locationId)
        .gte("declined_at", previousStart)
        .lte("declined_at", currentEnd)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("inspection")
        .select("completed_at, work_order!inner(location_id)")
        .eq("work_order.location_id", locationId)
        .gte("completed_at", previousStart)
        .lte("completed_at", currentEnd)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("time_clock_entry")
        .select("clock_in_at, clock_out_at")
        .eq("location_id", locationId)
        .is("voided_at", null)
        .gte("clock_in_at", lookback)
        .lte("clock_in_at", currentEnd)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("job_time_entry")
        .select("started_at, ended_at")
        .eq("location_id", locationId)
        .gte("started_at", lookback)
        .lte("started_at", currentEnd)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("part")
        .select("status, job!inner(work_order!inner(location_id))")
        .in("status", [...PARTS_WAITING_STATUSES])
        .eq("job.work_order.location_id", locationId)
        .limit(ROW_LIMIT)
    ),
    queryRows(
      admin
        .from("timeline_event")
        .select(
          "work_order_id, event_type, description, created_at, work_order!inner(location_id)"
        )
        .eq("work_order.location_id", locationId)
        .in("event_type", [...WEEKLY_REPORT_NOTE_EVENTS])
        .gte("created_at", window.current.startUtc.toISOString())
        .lte("created_at", currentEnd)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT)
    ),
  ]);

  return {
    now,
    workOrders: [...openRows, ...createdRows, ...completedRows, ...cancelledRows].map(
      (row) => mapWorkOrder(row, cancelledAt)
    ),
    jobs: mergeJobs([...completedJobs, ...approvedJobs, ...declinedJobs]),
    inspectionCompletedAt: inspections
      .map((row) => stringOf(row.completed_at))
      .filter((value): value is string => Boolean(value)),
    clock: clock.map(mapClock),
    jobTime: jobTime.map(mapJobTime),
    parts: parts.map((row) => ({ status: String(row.status ?? "") })),
    timeline: timeline
      .map(mapTimeline)
      .filter((event): event is WeeklyTimelineInput => Boolean(event)),
  };
}

function mergeJobs(rows: Row[]): WeeklyJobInput[] {
  const byId = new Map<string, WeeklyJobInput>();
  for (const row of rows) {
    const jobId = stringOf(row.job_id) ?? stringOf(row.work_order_id);
    if (!jobId) continue;
    byId.set(jobId, {
      workOrderId: String(row.work_order_id ?? ""),
      name: stringOf(row.service_name_snapshot) ?? "Job",
      completedAt: stringOf(row.completed_at),
      approvedAt: stringOf(row.approved_by_customer_at),
      declinedAt: stringOf(row.declined_at),
    });
  }
  return [...byId.values()];
}

/** Latest cancellation time per work order; a reopened bike keeps only its newest one. */
function latestCancellation(events: Row[]): Map<string, string> {
  const byWorkOrder = new Map<string, string>();
  for (const event of events) {
    const workOrderId = stringOf(event.work_order_id);
    const createdAt = stringOf(event.created_at);
    if (!workOrderId || !createdAt) continue;
    const existing = byWorkOrder.get(workOrderId);
    if (!existing || createdAt > existing) byWorkOrder.set(workOrderId, createdAt);
  }
  return byWorkOrder;
}

function mapWorkOrder(row: Row, cancelledAt: Map<string, string>): WeeklyWorkOrderInput {
  const motorcycle = asOne(row.motorcycle);
  const customer = asOne(row.customer);
  const customerName = [stringOf(customer?.first_name), stringOf(customer?.last_name)]
    .filter(Boolean)
    .join(" ");
  const year =
    motorcycle?.year == null || motorcycle.year === "" ? null : Number(motorcycle.year);
  return {
    workOrderId: String(row.work_order_id),
    workOrderNumber: stringOf(row.work_order_number),
    status: String(row.status ?? ""),
    createdAt: String(row.created_at ?? ""),
    completedAt: stringOf(row.completed_at),
    cancelledAt: cancelledAt.get(String(row.work_order_id)) ?? null,
    collectedCents: Number(row.billing_collected_cents ?? 0) || 0,
    year: year != null && Number.isFinite(year) ? year : null,
    make: stringOf(motorcycle?.make),
    model: stringOf(motorcycle?.model),
    customerName: customerName || null,
  };
}

function mapClock(row: Row): PunchInput {
  return {
    startedAt: String(row.clock_in_at ?? ""),
    endedAt: stringOf(row.clock_out_at),
  };
}

function mapJobTime(row: Row): PunchInput {
  return {
    startedAt: String(row.started_at ?? ""),
    endedAt: stringOf(row.ended_at),
  };
}

function mapTimeline(row: Row): WeeklyTimelineInput | null {
  const description = stringOf(row.description);
  const createdAt = stringOf(row.created_at);
  const workOrderId = stringOf(row.work_order_id);
  if (!description || !createdAt || !workOrderId) return null;
  return {
    workOrderId,
    eventType: String(row.event_type ?? ""),
    description,
    createdAt,
  };
}

function asOne(value: unknown): Row | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? (first as Row) : null;
  }
  return typeof value === "object" ? (value as Row) : null;
}

function stringOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function queryRows(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Row => Boolean(row) && typeof row === "object");
}
