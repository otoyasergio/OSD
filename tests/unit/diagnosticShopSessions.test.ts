import { describe, expect, it } from "vitest";
import {
  formatOpenFaultBikeCount,
  countOpenFaultBikes,
} from "@/lib/diagnostics/openFaults";
import { parseDiagnosticSessionForm } from "@/lib/diagnostics/sessionForm";
import { healthForSessions } from "@/lib/diagnostics/sessionView";
import type { DiagnosticSessionView } from "@/lib/diagnostics/sessionView";

const MOTORCYCLE = "ad000000-0000-4000-8000-000000000001";
const WORK_ORDER = "ae000000-0000-4000-8000-000000000001";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set("motorcycle_id", MOTORCYCLE);
  data.set("source", "scan_tool");
  data.set("scan_results", "complete");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function session(
  overrides: Partial<DiagnosticSessionView> & Pick<DiagnosticSessionView, "scan_results">
): DiagnosticSessionView {
  return {
    session_id: "session-1",
    motorcycle_id: MOTORCYCLE,
    work_order_id: null,
    location_id: "location-1",
    recorded_at: "2026-11-03T14:00:00.000Z",
    source: "scan_tool",
    notes: null,
    readings: [],
    ...overrides,
  };
}

describe("parseDiagnosticSessionForm", () => {
  it("accepts a complete scan with no codes", () => {
    const parsed = parseDiagnosticSessionForm(form({}));
    expect(parsed).toEqual({
      ok: true,
      value: {
        motorcycleId: MOTORCYCLE,
        workOrderId: null,
        source: "scan_tool",
        scanResults: "complete",
        notes: null,
        readings: [],
      },
    });
  });

  it("keeps a typed zero and omits a blank freeze-frame value", () => {
    const parsed = parseDiagnosticSessionForm(
      form({
        work_order_id: WORK_ORDER,
        code_0: "p0217",
        status_0: "active",
        description_0: "Coolant temperature high",
        severity_0: "P0",
        odometer_0: "0",
        rpm_0: "",
        coolant_c_0: "112",
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.workOrderId).toBe(WORK_ORDER);
    expect(parsed.value.readings[0]).toMatchObject({
      code: "P0217",
      status: "active",
      description: "Coolant temperature high",
      severity_hint: "P0",
      freeze_frame: { odometer: 0, coolant_c: 112 },
    });
    expect(parsed.value.readings[0]?.freeze_frame).not.toHaveProperty("rpm");
    expect(parsed.value.readings[0]?.freeze_frame).not.toHaveProperty("voltage");
  });

  it("rejects a description without a severity", () => {
    const parsed = parseDiagnosticSessionForm(
      form({ code_0: "P0217", status_0: "active", description_0: "Coolant" })
    );
    expect(parsed.ok).toBe(false);
  });

  it("rejects a code that is not letters, numbers, and hyphens", () => {
    const parsed = parseDiagnosticSessionForm(
      form({ code_0: "P 217", status_0: "active" })
    );
    expect(parsed.ok).toBe(false);
  });
});

describe("countOpenFaultBikes", () => {
  const bikes = [
    { motorcycle_id: "bike-a", customer_id: "fleet-1" },
    { motorcycle_id: "bike-b", customer_id: "fleet-1" },
  ];

  it("counts the latest complete scan and ignores a newer partial scan", () => {
    const counts = countOpenFaultBikes(
      bikes,
      [
        {
          session_id: "complete-old",
          motorcycle_id: "bike-a",
          recorded_at: "2026-11-01T12:00:00.000Z",
          scan_results: "complete",
        },
        {
          session_id: "partial-new",
          motorcycle_id: "bike-a",
          recorded_at: "2026-11-03T12:00:00.000Z",
          scan_results: "partial",
        },
        {
          session_id: "complete-clear",
          motorcycle_id: "bike-b",
          recorded_at: "2026-11-02T12:00:00.000Z",
          scan_results: "complete",
        },
      ],
      ["complete-old"]
    );
    expect(counts.get("fleet-1")).toBe(1);
  });

  it("does not count a pending reading on the latest complete scan", () => {
    const counts = countOpenFaultBikes(
      bikes,
      [
        {
          session_id: "complete-pending",
          motorcycle_id: "bike-a",
          recorded_at: "2026-11-03T12:00:00.000Z",
          scan_results: "complete",
        },
      ],
      []
    );
    expect(counts.has("fleet-1")).toBe(false);
  });

  it("breaks an equal recorded time toward the higher session id", () => {
    const counts = countOpenFaultBikes(
      [bikes[0]!],
      [
        {
          session_id: "session-a",
          motorcycle_id: "bike-a",
          recorded_at: "2026-11-03T12:00:00.000Z",
          scan_results: "complete",
        },
        {
          session_id: "session-b",
          motorcycle_id: "bike-a",
          recorded_at: "2026-11-03T12:00:00.000Z",
          scan_results: "complete",
        },
      ],
      ["session-b"]
    );
    expect(counts.get("fleet-1")).toBe(1);
  });
});

describe("formatOpenFaultBikeCount", () => {
  it("keeps zero distinct from a failed read", () => {
    expect(formatOpenFaultBikeCount(0)).toBe("0 bikes with open faults");
    expect(formatOpenFaultBikeCount(1)).toBe("1 bike with open faults");
    expect(formatOpenFaultBikeCount(null)).toBe("Open faults unavailable");
  });
});

describe("healthForSessions", () => {
  it("says the history could not be loaded", () => {
    const judged = healthForSessions(null, []);
    expect(judged.openFaultCount).toBeNull();
    expect(judged.health.faultText).toBe("Fault codes unavailable");
  });

  it("does not call an empty history healthy", () => {
    const judged = healthForSessions([], []);
    expect(judged.openFaultCount).toBeNull();
    expect(judged.health.faultText).toBe("Not scanned yet");
  });

  it("names a catalogued P0 on a partial scan", () => {
    const judged = healthForSessions(
      [
        session({
          scan_results: "partial",
          readings: [
            {
              reading_id: "reading-1",
              code: "P0217",
              status: "active",
              ecu: "ECM",
              freeze_frame: {},
            },
          ],
        }),
      ],
      [
        {
          dtc_code: "P0217",
          description: "Engine coolant temperature above limit",
          severity_hint: "P0",
        },
      ]
    );
    expect(judged.openFaultCount).toBe(1);
    expect(judged.health.faultText).toContain("P0");
    expect(judged.health.recommendedAction).toContain(
      "Engine coolant temperature above limit"
    );
  });

  it("does not treat unavailable results as zero faults", () => {
    const judged = healthForSessions(
      [
        session({
          scan_results: "unavailable",
          readings: [
            {
              reading_id: "reading-1",
              code: "P0217",
              status: "active",
              ecu: null,
              freeze_frame: {},
            },
          ],
        }),
      ],
      []
    );
    expect(judged.openFaultCount).toBeNull();
    expect(judged.health.faultText).toBe("Fault results not available");
    expect(judged.health.faultText).not.toBe("No open faults");
  });
});
