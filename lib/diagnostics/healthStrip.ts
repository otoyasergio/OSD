// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Health-strip copy ported from
// modules/cms_ui/source/frontend/src/components/vehicles/vehicle-detail/diagnostics/DiagnosticsHealthStrip.tsx
// in aws-solutions-library-samples/guidance-for-connected-mobility-on-aws.
//
// Absent data says why it is absent. It is never rendered as 0, and never as
// the bare word "unknown" that the first UAT could not interpret
// (issue 2026-09-25-diagnostics-ia-uat-defects).
//
// This shop records a scan the technician already took. There is no remote
// "Run diagnostic scan" and no "Dispatch to service" control.

import {
  computeVerdict,
  type CatalogEntry,
  type DtcReading,
  type VerdictResult,
} from "@/lib/diagnostics/verdict";

export type ScanHistoryState = "loading" | "unavailable" | "loaded";
export type ScanResultsState = "complete" | "partial" | "unavailable";

export type DiagnosticHealthInput = {
  scanHistory: ScanHistoryState;
  scanResults: ScanResultsState;
  /** Absent means there is no scan to count. Never default this to 0. */
  openFaultCount?: number;
  /** 'P0' | 'P1' | 'P2' | 'P3'. Absent or unrecognised is left off the fault line. */
  highestSeverity?: string;
  lastScanAt?: string | number;
  /** Absent means no scan readings are available to judge. */
  dtcs?: DtcReading[];
  /** Absent means the catalog itself did not load. An empty array is a real catalog. */
  catalog?: CatalogEntry[];
  ecusAnswered?: number;
  scanResultsOffloaded?: boolean;
};

export type DiagnosticHealthCopy = {
  faultText: string;
  lastScanText: string;
  recommendedAction: string;
};

/**
 * Matches VehicleDTCsTable `formatAge`:
 * "just now", "Xs ago", "N min ago", "N hrs ago", "N days ago".
 */
export function formatRelativeAge(ts: string | number | undefined): string {
  if (ts === undefined || ts === null) return "unknown";
  const ms = typeof ts === "number" ? ts : Date.parse(ts);
  if (isNaN(ms)) return "unknown";
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Recommended-action text from computeVerdict(). Replacing this with a
 * hardcoded string must break the test that asserts the text varies with
 * the verdict.
 */
export function verdictToRecommendedAction(
  verdict: VerdictResult | undefined,
  catalog: CatalogEntry[],
  dtcs: DtcReading[]
): string {
  if (verdict === undefined) {
    return "Run a scan to check this vehicle for fault codes.";
  }

  switch (verdict.tier) {
    case "Healthy":
      return "No issues found in the last scan.";

    case "Unrecognised":
      return "Undetermined — one or more fault codes could not be matched to the event catalog. Manual review required.";

    case "P0":
    case "P1":
    case "P2":
    case "P3": {
      const tier = verdict.tier;
      const descriptions: string[] = [];
      for (const dtc of dtcs) {
        const entry = catalog.find(
          (item) => item.dtc_code === dtc.code && item.severity_hint === tier
        );
        const description = entry?.description;
        if (description && !descriptions.includes(description)) {
          descriptions.push(description);
        }
      }
      const prefix = `${tier} — ${dtcs.length} fault code${dtcs.length !== 1 ? "s" : ""} detected.`;
      return descriptions.length > 0 ? `${prefix} ${descriptions.join(" ")}` : prefix;
    }
  }
}

export function describeDiagnosticHealth(
  input: DiagnosticHealthInput
): DiagnosticHealthCopy {
  const {
    scanHistory,
    scanResults,
    openFaultCount,
    highestSeverity,
    lastScanAt,
    dtcs,
    catalog,
    ecusAnswered,
    scanResultsOffloaded = false,
  } = input;

  const validSeverities = ["P0", "P1", "P2", "P3"];
  const severityText =
    highestSeverity && validSeverities.includes(highestSeverity)
      ? highestSeverity
      : undefined;

  const faultsPhrase = (count: number) =>
    `${count} open fault${count !== 1 ? "s" : ""}${severityText ? ` (${severityText} highest)` : ""}`;
  const answeredPhrase =
    ecusAnswered !== undefined
      ? `the ${ecusAnswered} ECU${ecusAnswered !== 1 ? "s" : ""} that answered`
      : "the ECUs that answered";

  let faultText: string;
  if (scanHistory === "loading") {
    faultText = "Checking for fault codes…";
  } else if (scanHistory === "unavailable") {
    faultText = "Fault codes unavailable";
  } else if (openFaultCount === undefined || openFaultCount === null) {
    faultText = "Not scanned yet";
  } else if (scanResults === "unavailable") {
    faultText = "Fault results not available";
  } else if (scanResults === "partial") {
    faultText =
      openFaultCount === 0
        ? `No open faults in ${answeredPhrase}`
        : `${faultsPhrase(openFaultCount)} in ${answeredPhrase}`;
  } else if (openFaultCount === 0) {
    faultText = "No open faults";
  } else {
    faultText = faultsPhrase(openFaultCount);
  }

  let lastScanText: string;
  if (scanHistory === "loading") {
    lastScanText = "Last scan: checking…";
  } else if (scanHistory === "unavailable") {
    lastScanText = "Last scan: unavailable";
  } else if (lastScanAt === undefined || lastScanAt === null) {
    lastScanText = "Last scan: none found";
  } else {
    const age = formatRelativeAge(lastScanAt);
    lastScanText =
      age === "unknown" ? "Last scan: time unavailable" : `Last scan: ${age}`;
  }

  const resolvedDtcs = dtcs ?? [];
  const resolvedCatalog = catalog ?? [];
  const verdict: VerdictResult | undefined =
    dtcs !== undefined ? computeVerdict(resolvedDtcs, resolvedCatalog) : undefined;
  const scanCount = resolvedDtcs.length;

  let recommendedAction: string;
  if (scanHistory === "loading") {
    recommendedAction = "Checking this vehicle's scan history…";
  } else if (scanHistory === "unavailable") {
    recommendedAction =
      "Couldn't load scan history. Run a scan to check this vehicle for fault codes.";
  } else if (dtcs !== undefined && scanResults === "unavailable") {
    recommendedAction = scanResultsOffloaded
      ? "The last scan's results are too large to show here."
      : "The last scan finished, but its results aren't available here. Run a new scan to check for fault codes.";
  } else if (dtcs !== undefined && scanCount > 0 && catalog === undefined) {
    const codes = [...new Set(resolvedDtcs.map((dtc) => dtc.code))];
    recommendedAction =
      `${scanCount} fault code${scanCount !== 1 ? "s" : ""} found in the last scan: ${codes.join(", ")}. ` +
      "Severity isn't available right now." +
      (scanResults === "partial"
        ? " Some ECUs didn't answer, so there may be more."
        : "");
  } else if (
    dtcs !== undefined &&
    scanResults === "partial" &&
    (verdict === undefined || verdict.tier === "Healthy")
  ) {
    recommendedAction =
      "Some ECUs didn't answer the last scan, so this result is incomplete. Run a scan again for a full result.";
  } else {
    recommendedAction =
      verdictToRecommendedAction(verdict, resolvedCatalog, resolvedDtcs) +
      (dtcs !== undefined && scanResults === "partial"
        ? " Some ECUs didn't answer, so there may be more."
        : "");
  }

  return { faultText, lastScanText, recommendedAction };
}
