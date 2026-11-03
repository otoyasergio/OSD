import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeDiagnosticHealth,
  formatRelativeAge,
  verdictToRecommendedAction,
} from "@/lib/diagnostics/healthStrip";
import type { CatalogEntry } from "@/lib/diagnostics/verdict";

const catalog: CatalogEntry[] = [
  {
    dtc_code: "P0217",
    severity_hint: "P0",
    description:
      "Engine coolant critically overheated — stop riding, let the engine cool.",
  },
];

describe("formatRelativeAge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says just now, then minutes, and unknown when the time cannot be read", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T15:00:00.000Z"));

    expect(formatRelativeAge("2026-11-03T14:59:55.000Z")).toBe("just now");
    expect(formatRelativeAge("2026-11-03T14:46:00.000Z")).toBe("14 min ago");
    expect(formatRelativeAge("not-a-time")).toBe("unknown");
    expect(formatRelativeAge(undefined)).toBe("unknown");
  });
});

describe("describeDiagnosticHealth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("claims nothing while scan history is still loading", () => {
    const health = describeDiagnosticHealth({
      scanHistory: "loading",
      scanResults: "complete",
    });

    expect(health.faultText).toBe("Checking for fault codes…");
    expect(health.lastScanText).toBe("Last scan: checking…");
    expect(health.recommendedAction).toBe("Checking this vehicle's scan history…");
  });

  it("says the history could not be loaded", () => {
    const health = describeDiagnosticHealth({
      scanHistory: "unavailable",
      scanResults: "complete",
    });

    expect(health.faultText).toBe("Fault codes unavailable");
    expect(health.lastScanText).toBe("Last scan: unavailable");
    expect(health.recommendedAction).toBe(
      "Couldn't load scan history. Run a scan to check this vehicle for fault codes."
    );
  });

  it("says the bike has not been scanned when nothing is on record", () => {
    const health = describeDiagnosticHealth({
      scanHistory: "loaded",
      scanResults: "complete",
    });

    expect(health.faultText).toBe("Not scanned yet");
    expect(health.lastScanText).toBe("Last scan: none found");
    expect(health.recommendedAction).toBe(
      "Run a scan to check this vehicle for fault codes."
    );
  });

  it("does not call a partial scan healthy", () => {
    const health = describeDiagnosticHealth({
      scanHistory: "loaded",
      scanResults: "partial",
      openFaultCount: 0,
      dtcs: [],
      catalog: [],
      ecusAnswered: 2,
      lastScanAt: "2026-11-03T14:00:00.000Z",
    });

    expect(health.faultText).toBe("No open faults in the 2 ECUs that answered");
    expect(health.recommendedAction).toBe(
      "Some ECUs didn't answer the last scan, so this result is incomplete. Run a scan again for a full result."
    );
  });

  it("names a P0 from the catalog verbatim", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T15:00:00.000Z"));
    const dtcs = [{ code: "P0217", status: "active" }];
    const health = describeDiagnosticHealth({
      scanHistory: "loaded",
      scanResults: "complete",
      openFaultCount: 1,
      highestSeverity: "P0",
      lastScanAt: "2026-11-03T14:00:00.000Z",
      dtcs,
      catalog,
    });

    expect(health.faultText).toBe("1 open fault (P0 highest)");
    expect(health.lastScanText).toBe("Last scan: 1 hr ago");
    expect(health.recommendedAction).toBe(
      "P0 — 1 fault code detected. Engine coolant critically overheated — stop riding, let the engine cool."
    );
    expect(verdictToRecommendedAction({ tier: "P0" }, catalog, dtcs)).toContain(
      "Engine coolant critically overheated"
    );
  });
});
