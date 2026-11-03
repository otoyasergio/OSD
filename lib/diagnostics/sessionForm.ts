import type {
  DiagnosticReadingStatus,
  DiagnosticScanResults,
  DiagnosticSessionSource,
} from "@/lib/diagnostics/sessionView";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,15}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLOT_COUNT = 8;

export type DiagnosticSeverity = "P0" | "P1" | "P2" | "P3";

export type ParsedDiagnosticReading = {
  code: string;
  status: DiagnosticReadingStatus;
  ecu: string | null;
  freeze_frame: {
    odometer?: number;
    rpm?: number;
    coolant_c?: number;
    voltage?: number;
  };
  description: string | null;
  severity_hint: DiagnosticSeverity | null;
};

export type ParsedDiagnosticSession = {
  motorcycleId: string;
  workOrderId: string | null;
  source: DiagnosticSessionSource;
  scanResults: DiagnosticScanResults;
  notes: string | null;
  readings: ParsedDiagnosticReading[];
};

export type DiagnosticFormParse =
  { ok: true; value: ParsedDiagnosticSession } | { ok: false; error: string };

type FormFailure = { ok: false; error: string };

function optionalUuid(value: string, label: string): string | null | FormFailure {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!UUID_PATTERN.test(trimmed)) return { ok: false, error: `${label} is not valid.` };
  return trimmed;
}

function optionalNumber(raw: string, label: string): number | undefined | FormFailure {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${label} must be a number, or left blank.` };
  }
  return value;
}

function isFailure(value: unknown): value is FormFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: boolean }).ok === false
  );
}

export function parseDiagnosticSessionForm(formData: FormData): DiagnosticFormParse {
  const motorcycleId = String(formData.get("motorcycle_id") ?? "").trim();
  if (!UUID_PATTERN.test(motorcycleId)) {
    return { ok: false, error: "That motorcycle is not valid." };
  }

  const workOrder = optionalUuid(
    String(formData.get("work_order_id") ?? ""),
    "Work order"
  );
  if (isFailure(workOrder)) return workOrder;

  const source = String(formData.get("source") ?? "");
  if (source !== "scan_tool" && source !== "manual") {
    return {
      ok: false,
      error: "Choose whether this came from a scan tool or was written down.",
    };
  }

  const scanResults = String(formData.get("scan_results") ?? "");
  if (
    scanResults !== "complete" &&
    scanResults !== "partial" &&
    scanResults !== "unavailable"
  ) {
    return {
      ok: false,
      error: "Choose whether the scan finished, was partial, or had no results.",
    };
  }

  const notesRaw = String(formData.get("notes") ?? "").trim();
  if (notesRaw.length > 2000) {
    return { ok: false, error: "Notes must be 2000 characters or fewer." };
  }

  const readings: ParsedDiagnosticReading[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const code = String(formData.get(`code_${slot}`) ?? "")
      .trim()
      .toUpperCase();
    const statusRaw = String(formData.get(`status_${slot}`) ?? "").trim();
    const ecuRaw = String(formData.get(`ecu_${slot}`) ?? "").trim();
    const descriptionRaw = String(formData.get(`description_${slot}`) ?? "").trim();
    const severityRaw = String(formData.get(`severity_${slot}`) ?? "").trim();
    const numberFields = [
      ["odometer", "Odometer"],
      ["rpm", "RPM"],
      ["coolant_c", "Coolant"],
      ["voltage", "Voltage"],
    ] as const;
    const numbers = numberFields.map(([key, label]) => ({
      key,
      label,
      value: optionalNumber(String(formData.get(`${key}_${slot}`) ?? ""), label),
    }));

    const hasAnything =
      Boolean(code) ||
      Boolean(ecuRaw) ||
      Boolean(descriptionRaw) ||
      Boolean(severityRaw) ||
      numbers.some((field) => field.value !== undefined);
    if (!code && !hasAnything) continue;
    if (!code) {
      return { ok: false, error: "Each filled row needs a fault code." };
    }
    if (!CODE_PATTERN.test(code)) {
      return {
        ok: false,
        error: "Fault codes use letters, numbers, and hyphens, up to 16 characters.",
      };
    }
    if (statusRaw !== "active" && statusRaw !== "pending" && statusRaw !== "stored") {
      return { ok: false, error: `Choose a status for ${code}.` };
    }
    if (ecuRaw.length > 40) {
      return { ok: false, error: `ECU for ${code} must be 40 characters or fewer.` };
    }
    if ((descriptionRaw && !severityRaw) || (!descriptionRaw && severityRaw)) {
      return {
        ok: false,
        error: `Add both a description and a severity for ${code}, or leave both blank.`,
      };
    }
    if (descriptionRaw.length > 400) {
      return {
        ok: false,
        error: `Description for ${code} must be 400 characters or fewer.`,
      };
    }
    if (
      severityRaw &&
      severityRaw !== "P0" &&
      severityRaw !== "P1" &&
      severityRaw !== "P2" &&
      severityRaw !== "P3"
    ) {
      return { ok: false, error: `Choose a P0–P3 severity for ${code}.` };
    }

    const freeze: ParsedDiagnosticReading["freeze_frame"] = {};
    for (const field of numbers) {
      if (isFailure(field.value)) return field.value;
      if (field.value !== undefined) freeze[field.key] = field.value;
    }

    readings.push({
      code,
      status: statusRaw,
      ecu: ecuRaw || null,
      freeze_frame: freeze,
      description: descriptionRaw || null,
      severity_hint: (severityRaw || null) as DiagnosticSeverity | null,
    });
  }

  return {
    ok: true,
    value: {
      motorcycleId,
      workOrderId: workOrder,
      source,
      scanResults,
      notes: notesRaw || null,
      readings,
    },
  };
}
