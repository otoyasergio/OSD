import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  auctionRefreshGroupKey,
  groupMotorcyclesForAuctionRefresh,
} from "@/lib/auctions/refreshGroups";
import {
  AUCTION_REFRESH_BUDGET_MS,
  auctionMotorcycleListQuery,
  motorcyclesForAuctionRefresh,
  runAuctionPriceRefresh,
  type AuctionRefreshBike,
} from "@/lib/services/auctionPriceRefresh";

const mt07 = (id: string, year: number): AuctionRefreshBike => ({
  motorcycleId: id,
  year,
  make: "Yamaha",
  model: "MT-07",
});

describe("auction refresh groups", () => {
  it("shares one provider query across years of the same model", () => {
    expect(auctionRefreshGroupKey({ make: "Yamaha", model: "MT-07" })).toBe(
      auctionRefreshGroupKey({ make: "Yamaha", model: "MT 07" })
    );
    expect(auctionRefreshGroupKey({ make: "H-D", model: "Sportster 883" })).toBe(
      auctionRefreshGroupKey({ make: "Harley-Davidson", model: "Sportster 883" })
    );
    expect(auctionRefreshGroupKey({ make: "Yamaha", model: "MT-07" })).not.toBe(
      auctionRefreshGroupKey({ make: "Yamaha", model: "MT-09" })
    );
  });

  it("skips a motorcycle that has no make or model to search", () => {
    expect(auctionRefreshGroupKey({ make: " ", model: "MT-07" })).toBeNull();
    expect(auctionRefreshGroupKey({ make: "Yamaha", model: " " })).toBeNull();
  });

  it("keeps the first bike in a group as the provider example", () => {
    const older = mt07("older", 2019);
    const newer = mt07("newer", 2022);
    const honda: AuctionRefreshBike = {
      motorcycleId: "honda",
      year: 2021,
      make: "Honda",
      model: "CB500F",
    };
    const blank: AuctionRefreshBike = {
      motorcycleId: "blank",
      year: 2020,
      make: "",
      model: "",
    };
    const grouped = groupMotorcyclesForAuctionRefresh([older, honda, newer, blank]);
    expect(grouped.skipped).toEqual([blank]);
    expect(
      grouped.groups.map((group) => group.bikes.map((bike) => bike.motorcycleId))
    ).toEqual([["older", "newer"], ["honda"]]);
  });
});

describe("daily auction refresh", () => {
  it("stays inside the cron time limit", () => {
    expect(AUCTION_REFRESH_BUDGET_MS).toBeLessThan(300_000);
    expect(AUCTION_REFRESH_BUDGET_MS).toBeGreaterThan(60_000);
  });

  it("asks the provider once per model, then rebuilds every motorcycle", async () => {
    const fetchLots = vi.fn().mockResolvedValue({
      configured: true,
      lots: [{ source: "altfn", sourceLotId: "1" }],
      message: null,
      failed: false,
    });
    const upsertLots = vi.fn().mockResolvedValue(1);
    const rebuildLocal = vi.fn().mockResolvedValue({ ok: true });
    const older = mt07("older", 2019);
    const newer = mt07("newer", 2022);
    const honda: AuctionRefreshBike = {
      motorcycleId: "honda",
      year: 2021,
      make: "Honda",
      model: "CB500F",
    };

    const result = await runAuctionPriceRefresh({
      hasKey: true,
      bikes: [older, newer, honda],
      fetchLots,
      upsertLots,
      rebuildLocal,
      startedAt: 0,
      deadlineMs: AUCTION_REFRESH_BUDGET_MS,
      now: () => 0,
    });

    expect(fetchLots).toHaveBeenCalledTimes(2);
    expect(fetchLots).toHaveBeenNthCalledWith(1, older);
    expect(fetchLots).toHaveBeenNthCalledWith(2, honda);
    expect(upsertLots).toHaveBeenCalledTimes(2);
    expect(rebuildLocal.mock.calls.map((call) => call[0].motorcycleId)).toEqual([
      "older",
      "newer",
      "honda",
    ]);
    expect(result).toEqual({
      ok: true,
      motorcycles: 3,
      groups: 2,
      providerFetches: 2,
      providerFailures: 0,
      lotsUpserted: 2,
      snapshotsRebuilt: 3,
      skipped: 0,
      failed: 0,
      remaining: 0,
      truncated: false,
    });
  });

  it("rebuilds Canadian prices from stored lots when no feed key is set", async () => {
    const fetchLots = vi.fn();
    const upsertLots = vi.fn();
    const rebuildLocal = vi.fn().mockResolvedValue({ ok: true });
    const result = await runAuctionPriceRefresh({
      hasKey: false,
      bikes: [mt07("older", 2019), mt07("newer", 2022)],
      fetchLots,
      upsertLots,
      rebuildLocal,
      startedAt: 0,
      deadlineMs: AUCTION_REFRESH_BUDGET_MS,
      now: () => 0,
    });

    expect(fetchLots).not.toHaveBeenCalled();
    expect(upsertLots).not.toHaveBeenCalled();
    expect(rebuildLocal).toHaveBeenCalledTimes(2);
    expect(result.providerFetches).toBe(0);
    expect(result.snapshotsRebuilt).toBe(2);
  });

  it("still rebuilds a motorcycle when the provider fails", async () => {
    const fetchLots = vi.fn().mockRejectedValue(new Error("ALT/FNDATA down"));
    const rebuildLocal = vi.fn().mockResolvedValue({ ok: true });
    const result = await runAuctionPriceRefresh({
      hasKey: true,
      bikes: [mt07("older", 2019)],
      fetchLots,
      upsertLots: vi.fn(),
      rebuildLocal,
      startedAt: 0,
      deadlineMs: AUCTION_REFRESH_BUDGET_MS,
      now: () => 0,
    });

    expect(rebuildLocal).toHaveBeenCalledTimes(1);
    expect(result.providerFailures).toBe(1);
    expect(result.snapshotsRebuilt).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("counts a motorcycle whose snapshot could not be saved", async () => {
    const rebuildLocal = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error("write failed"));
    const result = await runAuctionPriceRefresh({
      hasKey: false,
      bikes: [mt07("older", 2019), mt07("newer", 2022)],
      fetchLots: vi.fn(),
      upsertLots: vi.fn(),
      rebuildLocal,
      startedAt: 0,
      deadlineMs: AUCTION_REFRESH_BUDGET_MS,
      now: () => 0,
    });

    expect(result.snapshotsRebuilt).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("stops before the function times out and reports the remainder", async () => {
    let rebuilt = 0;
    const result = await runAuctionPriceRefresh({
      hasKey: true,
      bikes: [mt07("older", 2019), mt07("newer", 2022)],
      fetchLots: vi.fn().mockResolvedValue({
        configured: true,
        lots: [],
        message: null,
        failed: false,
      }),
      upsertLots: vi.fn(),
      rebuildLocal: vi.fn(async () => {
        rebuilt += 1;
        return { ok: true };
      }),
      startedAt: 1_000,
      deadlineMs: 50,
      now: () => (rebuilt >= 1 ? 2_000 : 1_000),
    });

    expect(rebuilt).toBe(1);
    expect(result.snapshotsRebuilt).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("includes a motorcycle whose only work order is already completed", async () => {
    const finished = mt07("finished", 2015);
    const inspected: AuctionRefreshBike = {
      motorcycleId: "inspected",
      year: 2017,
      make: "Yamaha",
      model: "MT-07",
    };
    const open = mt07("open", 2021);
    const bare = mt07("bare", 2018);
    const blank: AuctionRefreshBike = {
      motorcycleId: "blank",
      year: 2004,
      make: " ",
      model: " ",
    };
    const selected = motorcyclesForAuctionRefresh({
      motorcycles: [finished, inspected, open, bare, blank],
      workOrders: [
        {
          motorcycleId: "finished",
          status: "completed",
          completedAt: "2023-04-02T18:00:00.000Z",
          inspectionCompletedAt: "2023-03-01T18:00:00.000Z",
        },
        {
          motorcycleId: "inspected",
          status: "ready_for_pickup",
          completedAt: null,
          inspectionCompletedAt: "2024-09-12T15:00:00.000Z",
        },
        {
          motorcycleId: "open",
          status: "in_progress",
          completedAt: null,
          inspectionCompletedAt: null,
        },
      ],
    });

    expect(selected.map((bike) => bike.motorcycleId)).toEqual([
      "finished",
      "inspected",
      "open",
      "bare",
      "blank",
    ]);

    const rebuildLocal = vi.fn().mockResolvedValue({ ok: true });
    const result = await runAuctionPriceRefresh({
      hasKey: false,
      bikes: selected,
      fetchLots: vi.fn(),
      upsertLots: vi.fn(),
      rebuildLocal,
      startedAt: 0,
      deadlineMs: AUCTION_REFRESH_BUDGET_MS,
      now: () => 0,
    });

    expect(rebuildLocal.mock.calls.map((call) => call[0].motorcycleId)).toEqual([
      "finished",
      "inspected",
      "open",
      "bare",
    ]);
    expect(result.snapshotsRebuilt).toBe(4);
    expect(result.skipped).toBe(1);
    expect(result.motorcycles).toBe(5);
  });

  it("pages every motorcycle and does not filter to open jobs", () => {
    expect(auctionMotorcycleListQuery(0)).toEqual({
      table: "motorcycle",
      select: "motorcycle_id, year, make, model",
      order: "motorcycle_id",
      from: 0,
      to: 999,
    });
    expect(auctionMotorcycleListQuery(1)).toEqual({
      table: "motorcycle",
      select: "motorcycle_id, year, make, model",
      order: "motorcycle_id",
      from: 1000,
      to: 1999,
    });
    const service = readFileSync("lib/services/auctionPriceRefresh.ts", "utf8");
    expect(service).toContain('from("motorcycle")');
    expect(service).toContain("auctionMotorcycleListQuery");
    expect(service).not.toContain('.eq("status"');
    expect(service).not.toContain('.in("status"');
  });

  it("stops the run when the auction tables are missing", async () => {
    const rebuildLocal = vi.fn(async () => {
      throw new Error("AUCTION_TABLES_MISSING");
    });
    await expect(
      runAuctionPriceRefresh({
        hasKey: false,
        bikes: [mt07("older", 2019), mt07("newer", 2022)],
        fetchLots: vi.fn(),
        upsertLots: vi.fn(),
        rebuildLocal,
        startedAt: 0,
        deadlineMs: AUCTION_REFRESH_BUDGET_MS,
        now: () => 0,
      })
    ).rejects.toThrow("AUCTION_TABLES_MISSING");
    expect(rebuildLocal).toHaveBeenCalledTimes(1);
  });
});
