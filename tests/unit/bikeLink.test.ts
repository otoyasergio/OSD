import { describe, expect, it } from "vitest";
import {
  attentionLevel,
  interpretBikeReading,
  parseBikeReading,
  resolveServiceBaseline,
} from "@/lib/bikeLink/reading";

const recordedAt = new Date("2026-11-02T15:00:00.000Z");

describe("interpretBikeReading", () => {
  const baseline = resolveServiceBaseline({
    unit: "km",
    schedule: {
      intervalDistance: 6000,
      intervalDays: 365,
      lastServiceOdometer: 10000,
      lastServiceAt: new Date("2026-06-01T12:00:00.000Z"),
    },
    lastVisit: null,
  });

  it("marks service due when the kilometers pass the interval", () => {
    const report = interpretBikeReading(
      {
        odometer: 16400,
        batteryVolts: 12.6,
        faultCodes: [],
        recordedAt,
        source: "home",
        placeName: "Home",
      },
      baseline
    );

    expect(report.service).toBe("due");
    expect(report.serviceDetail).toContain("400 km past the interval");
    expect(report.battery).toBe("ok");
    expect(report.faults).toBe("none");
    expect(report.clientNote).toBe(
      "Service is due. The bike has done 6,400 km since the last service."
    );
  });

  it("marks service coming due inside the last 500 km", () => {
    const report = interpretBikeReading(
      {
        odometer: 15600,
        batteryVolts: 12.6,
        faultCodes: [],
        recordedAt,
        source: "shop_bay",
        placeName: null,
      },
      baseline
    );

    expect(report.service).toBe("due_soon");
    expect(report.clientNote).toBe(
      "Service is coming due. The bike has done 5,600 km since the last service."
    );
  });

  it("stays quiet when the reading is inside the interval and the battery is healthy", () => {
    const report = interpretBikeReading(
      {
        odometer: 11200,
        batteryVolts: 12.6,
        faultCodes: [],
        recordedAt,
        source: "shop_bay",
        placeName: null,
      },
      baseline
    );

    expect(report.service).toBe("ok");
    expect(report.serviceDetail).toContain("4,800 km left");
    expect(report.clientNote).toBeNull();
  });

  it("marks service due by time even when the kilometers are fine", () => {
    const report = interpretBikeReading(
      {
        odometer: 11000,
        batteryVolts: 12.7,
        faultCodes: [],
        recordedAt: new Date("2027-07-06T15:00:00.000Z"),
        source: "partner",
        placeName: "Winter storage",
      },
      baseline
    );

    expect(report.service).toBe("due");
    expect(report.clientNote).toBe(
      "Service is due. It has been 400 days since the last service."
    );
  });

  it("cannot tell service status without a last service on file", () => {
    const report = interpretBikeReading(
      {
        odometer: 22000,
        batteryVolts: null,
        faultCodes: [],
        recordedAt,
        source: "home",
        placeName: null,
      },
      resolveServiceBaseline({ unit: "km", schedule: null, lastVisit: null })
    );

    expect(report.service).toBe("unknown");
    expect(report.serviceDetail).toBe("No last service is on file.");
    expect(report.clientNote).toBeNull();
  });

  it("splits battery voltage into healthy, low, and flat", () => {
    const healthy = interpretBikeReading(
      {
        odometer: null,
        batteryVolts: 12.4,
        faultCodes: [],
        recordedAt,
        source: "home",
        placeName: null,
      },
      baseline
    );
    const low = interpretBikeReading(
      {
        odometer: null,
        batteryVolts: 12.2,
        faultCodes: [],
        recordedAt,
        source: "home",
        placeName: null,
      },
      baseline
    );
    const flat = interpretBikeReading(
      {
        odometer: null,
        batteryVolts: 11.7,
        faultCodes: [],
        recordedAt,
        source: "home",
        placeName: null,
      },
      baseline
    );

    expect(healthy.battery).toBe("ok");
    expect(healthy.clientNote).toBeNull();
    expect(low.battery).toBe("low");
    expect(low.clientNote).toBe("The battery is low at 12.2 V.");
    expect(flat.battery).toBe("flat");
    expect(flat.clientNote).toBe("The battery is flat at 11.7 V.");
  });

  it("writes one client note for a fault code and a low battery", () => {
    const report = interpretBikeReading(
      {
        odometer: 11200,
        batteryVolts: 12.2,
        faultCodes: ["p0335", "C14"],
        recordedAt,
        source: "partner",
        placeName: "Gear shop",
      },
      baseline
    );

    expect(report.faults).toBe("present");
    expect(report.faultDetail).toBe("Fault codes: P0335 (ignition system), C14.");
    expect(report.clientNote).toBe(
      "The battery is low at 12.2 V. The bike reported fault codes P0335 and C14."
    );
  });
});

describe("resolveServiceBaseline", () => {
  it("uses the last completed visit when the schedule has no service point", () => {
    const baseline = resolveServiceBaseline({
      unit: "km",
      schedule: null,
      lastVisit: {
        odometer: 8000,
        completedAt: new Date("2026-04-01T12:00:00.000Z"),
      },
    });

    expect(baseline.lastServiceOdometer).toBe(8000);
    expect(baseline.lastServiceAt?.toISOString()).toBe("2026-04-01T12:00:00.000Z");
    expect(baseline.intervalDistance).toBe(6000);
    expect(baseline.intervalDays).toBe(365);
    expect(baseline.dueSoonDistance).toBe(500);
  });

  it("lets a saved schedule replace the last visit and uses miles", () => {
    const baseline = resolveServiceBaseline({
      unit: "mi",
      schedule: {
        intervalDistance: 3500,
        intervalDays: 180,
        lastServiceOdometer: 12000,
        lastServiceAt: new Date("2026-08-01T12:00:00.000Z"),
      },
      lastVisit: {
        odometer: 9000,
        completedAt: new Date("2026-01-01T12:00:00.000Z"),
      },
    });

    expect(baseline.unit).toBe("mi");
    expect(baseline.intervalDistance).toBe(3500);
    expect(baseline.intervalDays).toBe(180);
    expect(baseline.lastServiceOdometer).toBe(12000);
    expect(baseline.dueSoonDistance).toBe(300);
    expect(baseline.lastServiceAt?.toISOString()).toBe("2026-08-01T12:00:00.000Z");
  });
});

describe("parseBikeReading", () => {
  it("accepts a shop reading and cleans fault codes", () => {
    const parsed = parseBikeReading({
      source: "shop_bay",
      placeName: "  ",
      odometer: "18420",
      batteryVolts: "12.6",
      faultCodes: "p0335, c14",
      recordedAt: "2026-11-02T10:00",
      previousOdometer: 18000,
      now: new Date("2026-11-02T15:00:00.000Z"),
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.reading.odometer).toBe(18420);
    expect(parsed.reading.batteryVolts).toBe(12.6);
    expect(parsed.reading.faultCodes).toEqual(["P0335", "C14"]);
    expect(parsed.reading.placeName).toBeNull();
    expect(parsed.reading.source).toBe("shop_bay");
  });

  it("rejects an odometer lower than the last reading", () => {
    const parsed = parseBikeReading({
      source: "home",
      placeName: "Home",
      odometer: "1000",
      batteryVolts: "",
      faultCodes: "",
      recordedAt: "2026-11-02T10:00",
      previousOdometer: 5000,
      now: new Date("2026-11-02T15:00:00.000Z"),
    });

    expect(parsed).toEqual({
      ok: false,
      error: "Odometer is lower than the last reading.",
    });
  });

  it("rejects a reading with nothing in it", () => {
    const parsed = parseBikeReading({
      source: "home",
      placeName: "",
      odometer: "",
      batteryVolts: "",
      faultCodes: "",
      recordedAt: "2026-11-02T10:00",
      previousOdometer: null,
      now: new Date("2026-11-02T15:00:00.000Z"),
    });

    expect(parsed.ok).toBe(false);
  });

  it("rejects a fault code the bike computer would not send", () => {
    const parsed = parseBikeReading({
      source: "partner",
      placeName: "Cafe",
      odometer: "",
      batteryVolts: "",
      faultCodes: "hello",
      recordedAt: "2026-11-02T10:00",
      previousOdometer: null,
      now: new Date("2026-11-02T15:00:00.000Z"),
    });

    expect(parsed).toEqual({
      ok: false,
      error: "Fault codes look like P0335 or C14.",
    });
  });
});

describe("attentionLevel", () => {
  const baseline = resolveServiceBaseline({
    unit: "km",
    schedule: {
      intervalDistance: 6000,
      intervalDays: 365,
      lastServiceOdometer: 10000,
      lastServiceAt: new Date("2026-06-01T12:00:00.000Z"),
    },
    lastVisit: null,
  });

  function reportFor(reading: {
    odometer: number | null;
    batteryVolts: number | null;
    faultCodes: string[];
  }) {
    return interpretBikeReading(
      { ...reading, recordedAt, source: "home", placeName: null },
      baseline
    );
  }

  it("puts a due service, a flat battery, or a fault code on the call-now list", () => {
    expect(
      attentionLevel(reportFor({ odometer: 16400, batteryVolts: 12.6, faultCodes: [] }))
    ).toBe("now");
    expect(
      attentionLevel(reportFor({ odometer: 11000, batteryVolts: 11.5, faultCodes: [] }))
    ).toBe("now");
    expect(
      attentionLevel(
        reportFor({ odometer: 11000, batteryVolts: 12.6, faultCodes: ["P0335"] })
      )
    ).toBe("now");
  });

  it("puts a coming-due service or a low battery on the call-soon list", () => {
    expect(
      attentionLevel(reportFor({ odometer: 15600, batteryVolts: 12.6, faultCodes: [] }))
    ).toBe("soon");
    expect(
      attentionLevel(reportFor({ odometer: 11000, batteryVolts: 12.2, faultCodes: [] }))
    ).toBe("soon");
  });

  it("leaves a healthy reading off the list", () => {
    expect(
      attentionLevel(reportFor({ odometer: 11200, batteryVolts: 12.6, faultCodes: [] }))
    ).toBeNull();
  });
});
