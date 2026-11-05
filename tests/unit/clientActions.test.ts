import { describe, expect, it } from "vitest";
import {
  composeStaffSms,
  decideClientActions,
  isClientActionOilService,
  reminderSnoozeUntil,
  type ClientActionCustomer,
  type ClientActionMotorcycle,
  type ClientActionResolution,
  type ClientActionVisit,
} from "@/lib/actions/clientActions";
import { shopDateKey } from "@/lib/datetime/format";

const NOW = "2026-11-06T18:00:00.000Z";
const MONDAY = "2026-11-02T18:00:00.000Z";

function customer(patch: Partial<ClientActionCustomer> = {}): ClientActionCustomer {
  return {
    customerId: "cust-1",
    dateOfBirth: null,
    phone: "+14165550100",
    smsOptedOut: false,
    hasCompletedVisit: true,
    ...patch,
  };
}

function visit(patch: Partial<ClientActionVisit> = {}): ClientActionVisit {
  return {
    workOrderId: "wo-1",
    customerId: "cust-1",
    motorcycleId: "bike-1",
    status: "in_progress",
    openedAt: MONDAY,
    createdAt: MONDAY,
    readyForPickupAt: null,
    latestMessageDirection: null,
    latestInboundAt: null,
    pendingRecommendationIds: [],
    partsEnteredAt: null,
    pickupSmsLoggedAfterReady: false,
    ...patch,
  };
}

function bike(patch: Partial<ClientActionMotorcycle> = {}): ClientActionMotorcycle {
  return {
    motorcycleId: "bike-1",
    customerId: "cust-1",
    lastCompletedAt: null,
    lastOilAt: null,
    ...patch,
  };
}

function decide(input: {
  now?: string;
  visits?: ClientActionVisit[];
  motorcycles?: ClientActionMotorcycle[];
  customers?: ClientActionCustomer[];
  resolutions?: ClientActionResolution[];
}) {
  return decideClientActions({
    now: input.now ?? NOW,
    visits: input.visits ?? [],
    motorcycles: input.motorcycles ?? [],
    customers: input.customers ?? [customer()],
    resolutions: input.resolutions ?? [],
  });
}

describe("decideClientActions visit cards", () => {
  it("shows one card when the latest message is inbound", () => {
    const cards = decide({
      visits: [
        visit({
          latestMessageDirection: "inbound",
          latestInboundAt: "2026-11-06T15:00:00.000Z",
          pendingRecommendationIds: ["rec-1"],
          status: "waiting_for_parts",
          partsEnteredAt: "2026-11-06T12:00:00.000Z",
        }),
      ],
    });
    expect(cards.map((card) => card.reason)).toEqual(["reply"]);
    expect(cards[0]?.title).toBe("Customer is waiting on a reply");
    expect(cards[0]?.cycleKey).toBe("wo:wo-1:reply:2026-11-06T15:00:00.000Z");
    expect(cards[0]?.workOrderId).toBe("wo-1");
  });

  it("shows approval ahead of parts and the four-day update", () => {
    const cards = decide({
      visits: [
        visit({
          pendingRecommendationIds: ["rec-b", "rec-a"],
          status: "waiting_for_parts",
          partsEnteredAt: "2026-11-06T12:00:00.000Z",
        }),
      ],
    });
    expect(cards.map((card) => card.reason)).toEqual(["approval"]);
    expect(cards[0]?.title).toBe("Approval is waiting");
    expect(cards[0]?.cycleKey).toBe("wo:wo-1:approval:rec-a,rec-b");
  });

  it("shows the parts card the day the whole bike is waiting on parts", () => {
    const cards = decide({
      now: MONDAY,
      visits: [
        visit({
          status: "waiting_for_parts",
          partsEnteredAt: MONDAY,
          openedAt: MONDAY,
        }),
      ],
    });
    expect(cards.map((card) => card.reason)).toEqual(["parts"]);
    expect(cards[0]?.title).toBe("Waiting on parts");
    expect(cards[0]?.cycleKey).toBe(`wo:wo-1:parts:${MONDAY}`);
  });

  it("shows ready for pickup until seven shop days have passed", () => {
    const cards = decide({
      visits: [
        visit({
          status: "ready_for_pickup",
          readyForPickupAt: "2026-11-04T18:00:00.000Z",
          openedAt: MONDAY,
        }),
      ],
    });
    expect(cards.map((card) => card.reason)).toEqual(["pickup"]);
    expect(cards[0]?.title).toBe("Ready for pickup");
    expect(cards[0]?.cycleKey).toBe("wo:wo-1:pickup:2026-11-04T18:00:00.000Z");
  });

  it("replaces the ready card with the week card after seven shop days", () => {
    const readyAt = MONDAY;
    const cards = decide({
      now: "2026-11-09T18:00:00.000Z",
      visits: [
        visit({
          status: "ready_for_pickup",
          readyForPickupAt: readyAt,
          openedAt: MONDAY,
        }),
      ],
    });
    expect(shopDateKey(MONDAY)).toBe("2026-11-02");
    expect(shopDateKey("2026-11-09T18:00:00.000Z")).toBe("2026-11-09");
    expect(cards.map((card) => card.reason)).toEqual(["pickup_week"]);
    expect(cards[0]?.title).toBe("Still waiting for pickup");
  });

  it("keeps the week card after the same-day text was sent", () => {
    const cards = decide({
      now: "2026-11-09T18:00:00.000Z",
      visits: [
        visit({
          status: "ready_for_pickup",
          readyForPickupAt: MONDAY,
          pickupSmsLoggedAfterReady: true,
        }),
      ],
      resolutions: [
        {
          reason: "pickup",
          cycleKey: `wo:wo-1:pickup:${MONDAY}`,
          outcome: "sent",
          snoozeUntil: null,
        },
      ],
    });
    expect(cards.map((card) => card.reason)).toEqual(["pickup_week"]);
  });

  it("clears the same-day card when a pickup text was already logged", () => {
    const cards = decide({
      visits: [
        visit({
          status: "ready_for_pickup",
          readyForPickupAt: "2026-11-06T15:00:00.000Z",
          pickupSmsLoggedAfterReady: true,
        }),
      ],
    });
    expect(cards).toEqual([]);
  });

  it("shows the four-day update on Friday after a Monday drop-off", () => {
    expect(shopDateKey(MONDAY)).toBe("2026-11-02");
    expect(shopDateKey(NOW)).toBe("2026-11-06");
    const cards = decide({
      visits: [visit({ openedAt: null, createdAt: MONDAY })],
    });
    expect(cards.map((card) => card.reason)).toEqual(["shop_days"]);
    expect(cards[0]?.title).toBe("In the shop longer than four days");
    expect(cards[0]?.cycleKey).toBe("wo:wo-1:shop_days");
  });

  it("waits until four shop days have passed", () => {
    const cards = decide({
      now: "2026-11-05T18:00:00.000Z",
      visits: [visit()],
    });
    expect(cards).toEqual([]);
  });

  it("hides pickup and four-day cards while the bike is in storage or insurance", () => {
    for (const status of ["in_storage", "insurance"] as const) {
      const cards = decide({
        visits: [
          visit({
            status,
            readyForPickupAt: MONDAY,
            openedAt: MONDAY,
          }),
        ],
      });
      expect(cards).toEqual([]);
    }
  });

  it("still shows a reply while the bike is in storage", () => {
    const cards = decide({
      visits: [
        visit({
          status: "in_storage",
          latestMessageDirection: "inbound",
          latestInboundAt: NOW,
        }),
      ],
    });
    expect(cards.map((card) => card.reason)).toEqual(["reply"]);
  });

  it("starts pickup cards again for a new ready time after storage", () => {
    const nextReady = "2026-11-06T16:00:00.000Z";
    const cards = decide({
      visits: [
        visit({
          status: "ready_for_pickup",
          readyForPickupAt: nextReady,
        }),
      ],
      resolutions: [
        {
          reason: "pickup",
          cycleKey: `wo:wo-1:pickup:${MONDAY}`,
          outcome: "sent",
          snoozeUntil: null,
        },
      ],
    });
    expect(cards.map((card) => card.reason)).toEqual(["pickup"]);
    expect(cards[0]?.cycleKey).toBe(`wo:wo-1:pickup:${nextReady}`);
  });

  it("ignores drafts", () => {
    const cards = decide({
      visits: [visit({ status: "draft", openedAt: "2026-01-01T18:00:00.000Z" })],
    });
    expect(cards).toEqual([]);
  });

  it("ignores completed and cancelled visits", () => {
    for (const status of ["completed", "cancelled"] as const) {
      const cards = decide({
        visits: [
          visit({
            status,
            openedAt: "2026-01-01T18:00:00.000Z",
            latestMessageDirection: "inbound",
            latestInboundAt: NOW,
            pendingRecommendationIds: ["rec-1"],
          }),
        ],
      });
      expect(cards).toEqual([]);
    }
  });

  it("does not turn a ready bike with no ready time into a four-day update", () => {
    const cards = decide({
      visits: [
        visit({
          status: "ready_for_pickup",
          readyForPickupAt: null,
          openedAt: "2026-01-01T18:00:00.000Z",
        }),
      ],
    });
    expect(cards).toEqual([]);
  });
});

describe("decideClientActions reminders", () => {
  const oldVisit = "2025-11-06T18:00:00.000Z";
  const oldOil = "2026-05-10T18:00:00.000Z";

  it("shows the year card and the oil card for a motorcycle with no open visit", () => {
    const cards = decide({
      motorcycles: [bike({ lastCompletedAt: oldVisit, lastOilAt: oldOil })],
    });
    expect(cards.map((card) => card.reason)).toEqual(["annual", "oil"]);
    expect(cards[0]?.title).toBe("Last visit was a year ago");
    expect(cards[1]?.title).toBe("Oil change is due");
    expect(cards[0]?.cycleKey).toBe(`motorcycle:bike-1:annual:${oldVisit}`);
    expect(cards[1]?.cycleKey).toBe(`motorcycle:bike-1:oil:${oldOil}`);
    expect(cards[0]?.workOrderId).toBeNull();
  });

  it("does not show a year card until 365 shop days have passed", () => {
    const cards = decide({
      motorcycles: [bike({ lastCompletedAt: "2025-11-07T18:00:00.000Z" })],
    });
    expect(cards).toEqual([]);
  });

  it("does not show an oil card until 180 shop days have passed", () => {
    const cards = decide({
      motorcycles: [bike({ lastOilAt: "2026-05-11T18:00:00.000Z" })],
    });
    expect(cards).toEqual([]);
  });

  it("hides birthday, annual, and oil cards while the customer has an open visit", () => {
    const cards = decide({
      now: "2026-07-04T18:00:00.000Z",
      visits: [visit({ openedAt: "2026-07-04T18:00:00.000Z" })],
      motorcycles: [
        bike({
          lastCompletedAt: "2024-01-01T18:00:00.000Z",
          lastOilAt: "2024-01-01T18:00:00.000Z",
        }),
      ],
      customers: [customer({ dateOfBirth: "1990-07-04" })],
    });
    expect(cards).toEqual([]);
  });

  it("shows a birthday on the matching shop date", () => {
    const cards = decide({
      now: "2026-07-04T18:00:00.000Z",
      customers: [customer({ dateOfBirth: "1990-07-04" })],
    });
    expect(cards.map((card) => card.reason)).toEqual(["birthday"]);
    expect(cards[0]?.title).toBe("Birthday");
    expect(cards[0]?.cycleKey).toBe("customer:cust-1:birthday:2026");
  });

  it("shows a February 29 birthday on February 28 in a non-leap year", () => {
    const cards = decide({
      now: "2026-02-28T18:00:00.000Z",
      customers: [customer({ dateOfBirth: "1992-02-29" })],
    });
    expect(cards.map((card) => card.reason)).toEqual(["birthday"]);
  });

  it("keeps a February 29 birthday on February 29 in a leap year", () => {
    const onTheDay = decide({
      now: "2024-02-29T18:00:00.000Z",
      customers: [customer({ dateOfBirth: "1992-02-29" })],
    });
    const dayBefore = decide({
      now: "2024-02-28T18:00:00.000Z",
      customers: [customer({ dateOfBirth: "1992-02-29" })],
    });
    expect(onTheDay.map((card) => card.reason)).toEqual(["birthday"]);
    expect(dayBefore).toEqual([]);
  });

  it("still shows reminders when the only visit is a draft", () => {
    const cards = decide({
      now: "2026-07-04T18:00:00.000Z",
      visits: [visit({ status: "draft", openedAt: "2026-07-04T18:00:00.000Z" })],
      motorcycles: [bike({ lastCompletedAt: "2024-01-01T18:00:00.000Z" })],
      customers: [customer({ dateOfBirth: "1990-07-04" })],
    });
    expect(cards.map((card) => card.reason)).toEqual(["annual", "birthday"]);
  });

  it("does not hide one customer's reminder because another customer has an open visit", () => {
    const cards = decide({
      visits: [visit()],
      motorcycles: [
        bike({
          motorcycleId: "bike-2",
          customerId: "cust-2",
          lastCompletedAt: "2025-11-06T18:00:00.000Z",
        }),
      ],
      customers: [customer(), customer({ customerId: "cust-2" })],
    });
    expect(cards.map((card) => card.reason)).toEqual(["shop_days", "annual"]);
    expect(cards[1]?.customerId).toBe("cust-2");
  });

  it("skips a birthday when the date is missing or the customer has no completed visit", () => {
    expect(
      decide({
        now: "2026-07-04T18:00:00.000Z",
        customers: [customer({ dateOfBirth: null })],
      })
    ).toEqual([]);
    expect(
      decide({
        now: "2026-07-04T18:00:00.000Z",
        customers: [customer({ dateOfBirth: "1990-07-04", hasCompletedVisit: false })],
      })
    ).toEqual([]);
  });
});

describe("decideClientActions send and dismiss", () => {
  it("clears a visit card after send or dismiss", () => {
    const open = visit();
    for (const outcome of ["sent", "dismissed"] as const) {
      const cards = decide({
        visits: [open],
        resolutions: [
          {
            reason: "shop_days",
            cycleKey: "wo:wo-1:shop_days",
            outcome,
            snoozeUntil: null,
          },
        ],
      });
      expect(cards).toEqual([]);
    }
  });

  it("hides a reminder for 30 days after dismiss and brings it back when the snooze ends", () => {
    const motorcycle = bike({ lastCompletedAt: "2025-11-06T18:00:00.000Z" });
    const hidden = decide({
      motorcycles: [motorcycle],
      resolutions: [
        {
          reason: "annual",
          cycleKey: "motorcycle:bike-1:annual:2025-11-06T18:00:00.000Z",
          outcome: "dismissed",
          snoozeUntil: "2026-12-06",
        },
      ],
    });
    const back = decide({
      motorcycles: [motorcycle],
      resolutions: [
        {
          reason: "annual",
          cycleKey: "motorcycle:bike-1:annual:2025-11-06T18:00:00.000Z",
          outcome: "dismissed",
          snoozeUntil: "2026-11-06",
        },
      ],
    });
    expect(hidden).toEqual([]);
    expect(back.map((card) => card.reason)).toEqual(["annual"]);
  });

  it("keeps a sent reminder cleared for that occurrence", () => {
    const cards = decide({
      now: "2026-07-04T18:00:00.000Z",
      customers: [customer({ dateOfBirth: "1990-07-04" })],
      resolutions: [
        {
          reason: "birthday",
          cycleKey: "customer:cust-1:birthday:2026",
          outcome: "sent",
          snoozeUntil: null,
        },
      ],
    });
    expect(cards).toEqual([]);
  });

  it("names why a text cannot be sent", () => {
    const noPhone = decide({
      visits: [visit()],
      customers: [customer({ phone: null })],
    });
    const optedOut = decide({
      visits: [visit()],
      customers: [customer({ smsOptedOut: true })],
    });
    expect(noPhone[0]?.smsBlock).toBe("phone");
    expect(optedOut[0]?.smsBlock).toBe("opt_out");
  });

  it("treats an unusable phone as a missing number", () => {
    const cards = decide({
      visits: [visit()],
      customers: [customer({ phone: "555" })],
    });
    expect(cards[0]?.smsBlock).toBe("phone");
  });

  it("keeps a dismissed reminder hidden when no snooze date was stored", () => {
    const cards = decide({
      motorcycles: [bike({ lastCompletedAt: "2025-11-06T18:00:00.000Z" })],
      resolutions: [
        {
          reason: "annual",
          cycleKey: "motorcycle:bike-1:annual:2025-11-06T18:00:00.000Z",
          outcome: "dismissed",
          snoozeUntil: null,
        },
      ],
    });
    expect(cards).toEqual([]);
  });
});

describe("staff SMS body", () => {
  it("appends the opt-out footer to the staff text", () => {
    expect(composeStaffSms("  The bike is ready.  ")).toBe(
      "The bike is ready. Reply STOP to opt out."
    );
  });

  it("does not append the footer twice", () => {
    expect(composeStaffSms("See you soon. Reply STOP to opt out.")).toBe(
      "See you soon. Reply STOP to opt out."
    );
  });

  it("rejects a blank message", () => {
    expect(composeStaffSms("   ")).toBeNull();
  });

  it("snoozes a reminder for 30 shop days", () => {
    expect(reminderSnoozeUntil("2026-11-05")).toBe("2026-12-05");
  });
});

describe("isClientActionOilService", () => {
  it("counts an oil change and a seasonal tune-up", () => {
    expect(isClientActionOilService("Oil change")).toBe(true);
    expect(isClientActionOilService("Fall tune up")).toBe(true);
    expect(isClientActionOilService("Spring/summer tune up")).toBe(true);
    expect(isClientActionOilService("Brake service")).toBe(false);
  });
});
