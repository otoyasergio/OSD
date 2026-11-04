import { describe, expect, it, vi } from "vitest";
import {
  auctionFxNote,
  cadPerUsdOn,
  FALLBACK_CAD_PER_USD,
  mergeUsdCadRates,
  parseValetUsdCad,
  usdToCad,
  USD_CAD_DAILY_SERIES,
  USD_CAD_DAILY_START,
  USD_CAD_MONTHLY_SERIES,
} from "@/lib/auctions/cad";
import { loadUsdCadRateBook } from "@/lib/auctions/cadRates";

describe("US dollar to Canadian dollar rates", () => {
  it("reads Bank of Canada valet observations and skips blank days", () => {
    const points = parseValetUsdCad(
      {
        observations: [
          { d: "2024-01-03", FXUSDCAD: { v: "1.3400" } },
          { d: "2024-01-02", FXUSDCAD: { v: "1.3300" } },
          { d: "2024-01-04", FXUSDCAD: { e: -64 } },
          { d: "bad", FXUSDCAD: { v: "1.2000" } },
        ],
      },
      USD_CAD_DAILY_SERIES
    );

    expect(points.map((point) => point.date)).toEqual(["2024-01-02", "2024-01-03"]);
    expect(points[1].cadPerUsd).toBe(1.34);
  });

  it("uses the monthly average before 2017 and the daily rate after", () => {
    const book = mergeUsdCadRates(
      [
        { date: "2016-12-01", cadPerUsd: 1.32 },
        { date: "2017-01-01", cadPerUsd: 1.31 },
        { date: "2004-06-01", cadPerUsd: 1.36 },
      ],
      [
        { date: "2017-01-03", cadPerUsd: 1.3435 },
        { date: "2024-06-03", cadPerUsd: 1.37 },
      ]
    );

    expect(book.source).toBe("bank-of-canada");
    expect(cadPerUsdOn(book, "2004-06-20")).toBe(1.36);
    expect(cadPerUsdOn(book, "2016-12-20")).toBe(1.32);
    expect(cadPerUsdOn(book, "2017-01-02")).toBe(1.32);
    expect(cadPerUsdOn(book, USD_CAD_DAILY_START)).toBe(1.3435);
    expect(cadPerUsdOn(book, "2024-06-04")).toBe(1.37);
    expect(cadPerUsdOn(book, "1990-01-01")).toBe(1.36);
    expect(cadPerUsdOn(book, null)).toBe(1.37);
    expect(auctionFxNote(book).label).toContain("monthly average");
  });

  it("says when sales before the daily series use the first daily rate", () => {
    const book = mergeUsdCadRates(
      [],
      [
        { date: "2017-01-03", cadPerUsd: 1.3435 },
        { date: "2024-06-03", cadPerUsd: 1.37 },
      ]
    );
    expect(cadPerUsdOn(book, "2010-06-01")).toBe(1.3435);
    expect(auctionFxNote(book).label).toContain("Sales before");
    expect(auctionFxNote(book).label).toContain("2017");
  });

  it("rounds a converted sale to the nearest Canadian dollar", () => {
    expect(usdToCad(4000, 1.25)).toBe(5000);
    expect(usdToCad(100, 1.3333)).toBe(133);
  });

  it("uses the stand-in rate when a quoted rate is zero or runaway", () => {
    const standIn = usdToCad(1000, FALLBACK_CAD_PER_USD);
    expect(usdToCad(1000, 0)).toBe(standIn);
    expect(usdToCad(1000, 12)).toBe(standIn);
    expect(usdToCad(1000, Number.NaN)).toBe(standIn);

    expect(
      parseValetUsdCad(
        {
          observations: [
            { d: "2024-01-02", FXUSDCAD: { v: "0" } },
            { d: "2024-01-03", FXUSDCAD: { v: "12" } },
            { d: "2024-01-04", FXUSDCAD: { v: "1.35" } },
          ],
        },
        USD_CAD_DAILY_SERIES
      )
    ).toEqual([{ date: "2024-01-04", cadPerUsd: 1.35 }]);
  });

  it("loads both Bank of Canada series and falls back when they are unavailable", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes(USD_CAD_MONTHLY_SERIES)) {
        return new Response(
          JSON.stringify({
            observations: [{ d: "2004-06-01", IEXM0101: { v: "1.3600" } }],
          })
        );
      }
      if (String(url).includes(USD_CAD_DAILY_SERIES)) {
        return new Response(
          JSON.stringify({
            observations: [{ d: "2024-06-03", FXUSDCAD: { v: "1.3700" } }],
          })
        );
      }
      return new Response("missing", { status: 404 });
    });

    const book = await loadUsdCadRateBook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(book.source).toBe("bank-of-canada");
    expect(cadPerUsdOn(book, "2004-06-20")).toBe(1.36);
    expect(cadPerUsdOn(book, "2024-06-03")).toBe(1.37);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const failed = await loadUsdCadRateBook({
      fetchImpl: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    expect(failed.source).toBe("fallback");
    expect(cadPerUsdOn(failed, "2020-01-01")).toBeGreaterThan(1);
    expect(auctionFxNote(failed).label).toContain("approximate");
  });
});
