import type { CatalogEntry } from "@/lib/diagnostics/verdict";
import { computeVerdict } from "@/lib/diagnostics/verdict";
import {
  describeDiagnosticHealth,
  type DiagnosticHealthCopy,
} from "@/lib/diagnostics/healthStrip";

export type DiagnosticScanResults = "complete" | "partial" | "unavailable";
export type DiagnosticReadingStatus = "active" | "pending" | "stored";
export type DiagnosticSessionSource = "scan_tool" | "manual";

export type FreezeFrame = {
  odometer?: number;
  rpm?: number;
  coolant_c?: number;
  voltage?: number;
};

export type DiagnosticReadingView = {
  reading_id: string;
  code: string;
  status: DiagnosticReadingStatus;
  ecu: string | null;
  freeze_frame: FreezeFrame;
};

export type DiagnosticSessionView = {
  session_id: string;
  motorcycle_id: string;
  work_order_id: string | null;
  location_id: string;
  recorded_at: string;
  source: DiagnosticSessionSource;
  notes: string | null;
  scan_results: DiagnosticScanResults;
  readings: DiagnosticReadingView[];
};

const FREEZE_FRAME_KEYS = ["odometer", "rpm", "coolant_c", "voltage"] as const;

export function parseFreezeFrame(value: unknown): FreezeFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const frame: FreezeFrame = {};
  for (const key of FREEZE_FRAME_KEYS) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) frame[key] = raw;
  }
  return frame;
}

export function freezeFrameEntries(
  frame: FreezeFrame
): Array<{ label: string; value: string }> {
  const labels: Record<keyof FreezeFrame, string> = {
    odometer: "Odometer",
    rpm: "RPM",
    coolant_c: "Coolant °C",
    voltage: "Voltage",
  };
  return FREEZE_FRAME_KEYS.filter((key) => frame[key] !== undefined).map((key) => ({
    label: labels[key],
    value: String(frame[key]),
  }));
}

export type DiagnosticPanelData = {
  motorcycleId: string;
  loadFailed: boolean;
  sessions: DiagnosticSessionView[];
  catalog: CatalogEntry[];
  health: DiagnosticHealthCopy;
  openFaultCount: number | null;
};

export function unavailableDiagnosticPanel(motorcycleId: string): DiagnosticPanelData {
  const judged = healthForSessions(null, null);
  return {
    motorcycleId,
    loadFailed: true,
    sessions: [],
    catalog: [],
    health: judged.health,
    openFaultCount: null,
  };
}

/** Latest session drives the strip. `null` sessions means the read failed. */
export function healthForSessions(
  sessions: DiagnosticSessionView[] | null,
  catalog: CatalogEntry[] | null
): { health: DiagnosticHealthCopy; openFaultCount: number | null } {
  if (sessions === null) {
    return {
      health: describeDiagnosticHealth({
        scanHistory: "unavailable",
        scanResults: "complete",
      }),
      openFaultCount: null,
    };
  }

  const latest = sessions[0];
  if (!latest) {
    return {
      health: describeDiagnosticHealth({
        scanHistory: "loaded",
        scanResults: "complete",
      }),
      openFaultCount: null,
    };
  }

  const active = latest.readings.filter((reading) => reading.status === "active");
  const dtcs = active.map((reading) => ({
    code: reading.code,
    status: reading.status,
    ecu: reading.ecu ?? undefined,
  }));
  const verdict =
    latest.scan_results === "unavailable" || catalog === null
      ? null
      : computeVerdict(dtcs, catalog);
  const highestSeverity =
    verdict && verdict.tier !== "Healthy" && verdict.tier !== "Unrecognised"
      ? verdict.tier
      : undefined;
  const ecuCount = new Set(
    latest.readings.flatMap((reading) => (reading.ecu ? [reading.ecu] : []))
  ).size;

  return {
    openFaultCount: latest.scan_results === "unavailable" ? null : active.length,
    health: describeDiagnosticHealth({
      scanHistory: "loaded",
      scanResults: latest.scan_results,
      openFaultCount: latest.scan_results === "unavailable" ? 0 : active.length,
      highestSeverity,
      lastScanAt: latest.recorded_at,
      dtcs: latest.scan_results === "unavailable" ? [] : dtcs,
      catalog: catalog === null ? undefined : catalog,
      ecusAnswered:
        latest.scan_results === "partial" && ecuCount > 0 ? ecuCount : undefined,
    }),
  };
}
