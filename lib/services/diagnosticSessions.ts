import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { Json } from "@/lib/database/supabase.generated";
import {
  countOpenFaultBikes,
  latestCompleteSessions,
} from "@/lib/diagnostics/openFaults";
import type { ParsedDiagnosticSession } from "@/lib/diagnostics/sessionForm";
import {
  healthForSessions,
  parseFreezeFrame,
  type DiagnosticPanelData,
  type DiagnosticReadingStatus,
  type DiagnosticScanResults,
  type DiagnosticSessionSource,
  type DiagnosticSessionView,
} from "@/lib/diagnostics/sessionView";
import type { CatalogEntry } from "@/lib/diagnostics/verdict";
import {
  canRecordDiagnosticSession,
  canViewClients,
  isFloorTech,
} from "@/lib/permissions";
import { toRpcErrorCode } from "@/lib/services/errors";

export type { DiagnosticPanelData };

const SCAN_RESULTS = new Set<DiagnosticScanResults>([
  "complete",
  "partial",
  "unavailable",
]);
const SOURCES = new Set<DiagnosticSessionSource>(["scan_tool", "manual"]);
const STATUSES = new Set<DiagnosticReadingStatus>(["active", "pending", "stored"]);

function canViewDiagnosticSessions(role: Parameters<typeof canViewClients>[0]) {
  return canViewClients(role) || isFloorTech(role);
}

type ReadingRow = {
  reading_id: string;
  code: string;
  status: string;
  ecu: string | null;
  freeze_frame: unknown;
};

type SessionRow = {
  session_id: string;
  motorcycle_id: string;
  work_order_id: string | null;
  location_id: string;
  recorded_at: string;
  source: string;
  notes: string | null;
  scan_results: string;
  readings: ReadingRow[] | ReadingRow | null;
};

function asReadings(value: SessionRow["readings"]): ReadingRow[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function mapSession(row: SessionRow): DiagnosticSessionView | null {
  if (!SCAN_RESULTS.has(row.scan_results as DiagnosticScanResults)) return null;
  if (!SOURCES.has(row.source as DiagnosticSessionSource)) return null;
  return {
    session_id: row.session_id,
    motorcycle_id: row.motorcycle_id,
    work_order_id: row.work_order_id,
    location_id: row.location_id,
    recorded_at: row.recorded_at,
    source: row.source as DiagnosticSessionSource,
    notes: row.notes,
    scan_results: row.scan_results as DiagnosticScanResults,
    readings: asReadings(row.readings).flatMap((reading) => {
      if (!STATUSES.has(reading.status as DiagnosticReadingStatus)) return [];
      return [
        {
          reading_id: reading.reading_id,
          code: reading.code,
          status: reading.status as DiagnosticReadingStatus,
          ecu: reading.ecu,
          freeze_frame: parseFreezeFrame(reading.freeze_frame),
        },
      ];
    }),
  };
}

export async function getDiagnosticPanel(
  motorcycleId: string
): Promise<DiagnosticPanelData> {
  const user = await requireUser();
  if (!canViewDiagnosticSessions(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  const [sessionResult, catalogResult] = await Promise.all([
    supabase
      .from("diagnostic_session")
      .select(
        `
        session_id, motorcycle_id, work_order_id, location_id, recorded_at,
        source, notes, scan_results,
        readings:diagnostic_reading ( reading_id, code, status, ecu, freeze_frame )
      `
      )
      .eq("motorcycle_id", motorcycleId)
      .order("recorded_at", { ascending: false })
      .limit(20),
    user.active_location_id
      ? supabase
          .from("diagnostic_catalog")
          .select("dtc_code, description, severity_hint")
          .eq("location_id", user.active_location_id)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sessionResult.error) {
    const failed = healthForSessions(null, null);
    return {
      motorcycleId,
      loadFailed: true,
      sessions: [],
      catalog: [],
      health: failed.health,
      openFaultCount: null,
    };
  }

  const sessions = ((sessionResult.data ?? []) as unknown as SessionRow[])
    .map(mapSession)
    .filter((session): session is DiagnosticSessionView => session !== null);
  const catalog: CatalogEntry[] | null = catalogResult.error
    ? null
    : ((catalogResult.data ?? []) as CatalogEntry[]);
  const judged = healthForSessions(sessions, catalog);

  return {
    motorcycleId,
    loadFailed: false,
    sessions,
    catalog: catalog ?? [],
    health: judged.health,
    openFaultCount: judged.openFaultCount,
  };
}

export async function getDiagnosticsForWorkOrder(workOrderId: string) {
  const user = await requireUser();
  if (!canViewDiagnosticSessions(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_order")
    .select("motorcycle_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return getDiagnosticPanel(data.motorcycle_id);
}

export async function recordDiagnosticSession(
  input: ParsedDiagnosticSession
): Promise<string> {
  const user = await requireUser();
  if (!canRecordDiagnosticSession(user.role)) throw new Error("FORBIDDEN");
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  const supabase = await createClient();

  const { data: motorcycle, error: motorcycleError } = await supabase
    .from("motorcycle")
    .select("motorcycle_id")
    .eq("motorcycle_id", input.motorcycleId)
    .maybeSingle();
  if (motorcycleError) throw motorcycleError;
  if (!motorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");

  let locationId = user.active_location_id;
  if (input.workOrderId) {
    const { data: workOrder, error: workOrderError } = await supabase
      .from("work_order")
      .select("motorcycle_id, location_id")
      .eq("work_order_id", input.workOrderId)
      .maybeSingle();
    if (workOrderError) throw workOrderError;
    if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
    if (workOrder.motorcycle_id !== input.motorcycleId) {
      throw new Error("MOTORCYCLE_MISMATCH");
    }
    if (workOrder.location_id !== user.active_location_id) {
      throw new Error("FOREIGN_LOCATION");
    }
    locationId = workOrder.location_id;
  }

  const readings: Json = input.readings.map((reading) => ({
    code: reading.code,
    status: reading.status,
    ecu: reading.ecu,
    freeze_frame: reading.freeze_frame,
    description: reading.description,
    severity_hint: reading.severity_hint,
  }));

  const { data, error } = await supabase.rpc("record_diagnostic_session", {
    p_motorcycle_id: input.motorcycleId,
    p_work_order_id: input.workOrderId,
    p_location_id: locationId,
    p_source: input.source,
    p_scan_results: input.scanResults,
    p_notes: input.notes,
    p_readings: readings,
  });
  if (error) throw new Error(toRpcErrorCode(error));
  if (!data) throw new Error("DIAGNOSTIC_SESSION_INVALID");
  return data;
}

export async function removeDiagnosticSession(sessionId: string): Promise<void> {
  const user = await requireUser();
  if (!canRecordDiagnosticSession(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("diagnostic_session")
    .delete()
    .eq("session_id", sessionId)
    .select("session_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("FORBIDDEN");
}

export async function countOpenFaultBikesByCustomer(
  customerIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const customerId of customerIds) counts.set(customerId, 0);
  if (customerIds.length === 0) return counts;

  const user = await requireUser();
  if (!canViewDiagnosticSessions(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  const { data: motorcycles, error: motorcycleError } = await supabase
    .from("motorcycle")
    .select("motorcycle_id, customer_id")
    .in("customer_id", customerIds);
  if (motorcycleError) throw motorcycleError;
  const bikes = motorcycles ?? [];
  if (bikes.length === 0) return counts;

  const { data: sessions, error: sessionError } = await supabase
    .from("diagnostic_session")
    .select("session_id, motorcycle_id, recorded_at, scan_results")
    .in(
      "motorcycle_id",
      bikes.map((bike) => bike.motorcycle_id)
    )
    .eq("scan_results", "complete");
  if (sessionError) throw sessionError;

  const completeSessions = sessions ?? [];
  const latestIds = latestCompleteSessions(completeSessions).map(
    (session) => session.session_id
  );
  if (latestIds.length === 0) return counts;

  const { data: readings, error: readingError } = await supabase
    .from("diagnostic_reading")
    .select("session_id, status")
    .in("session_id", latestIds)
    .eq("status", "active");
  if (readingError) throw readingError;

  const counted = countOpenFaultBikes(
    bikes,
    completeSessions,
    (readings ?? []).map((reading) => reading.session_id)
  );
  for (const [customerId, count] of counted) counts.set(customerId, count);
  return counts;
}
