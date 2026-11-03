import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  fetchAltfnMotorcycleLots,
  mapAltfnMotorcycleRow,
  safeHttpUrl,
} from "@/lib/auctions/altfndata";
import { auctionLotMatchesBike, makeKey } from "@/lib/auctions/match";
import { recordsFromAuctionFile } from "@/lib/auctions/parseLots";
import { parseStoredAuctionGuide } from "@/lib/auctions/schema";
import {
  buildStoredAuctionGuide,
  inspectionAuctionCallout,
  median,
  planAuctionRefresh,
  presentAuctionPriceGuide,
} from "@/lib/auctions/summary";
import type {
  AuctionLotRecord,
  BikeIdentity,
  StoredAuctionGuide,
} from "@/lib/auctions/types";

const parityFx = {
  cadPerUsd: () => 1,
  fx: {
    source: "bank-of-canada" as const,
    label:
      "the Bank of Canada rate on each sale date. Daily rates are used from 2017, and the monthly average before that",
  },
};

function guideFrom(
  args: Omit<Parameters<typeof buildStoredAuctionGuide>[0], "cadPerUsd" | "fx"> &
    Partial<Pick<Parameters<typeof buildStoredAuctionGuide>[0], "cadPerUsd" | "fx">>
): StoredAuctionGuide {
  return buildStoredAuctionGuide({ ...parityFx, ...args });
}

function lot(
  overrides: Partial<AuctionLotRecord> & Pick<AuctionLotRecord, "title" | "priceUsd">
): AuctionLotRecord {
  return {
    source: "altfndata",
    sourceLotId: overrides.title,
    make: "Harley-Davidson",
    model: "Iron 883",
    modelYear: 2019,
    vendor: "Mecum",
    saleDate: "2024-06-01",
    status: "sold",
    hammerAmount: overrides.priceUsd,
    hammerCurrency: "USD",
    location: "Las Vegas",
    country: "United States",
    lotUrl: `https://example.com/${encodeURIComponent(overrides.title)}`,
    ...overrides,
  };
}

const iron: BikeIdentity = { year: 2019, make: "Harley-Davidson", model: "Iron 883" };

describe("make and model matching", () => {
  it("treats H-D and Harley-Davidson as the same make", () => {
    expect(makeKey("H-D")).toBe("harley-davidson");
    expect(makeKey("Harley Davidson")).toBe("harley-davidson");
    expect(
      auctionLotMatchesBike(
        { ...iron, make: "H-D" },
        lot({
          title: "2019 Harley-Davidson XL883N Iron 883",
          priceUsd: 7000,
          model: "XL883N",
        })
      )
    ).toBe(true);
  });

  it("keeps a lot that mentions mileage and condition", () => {
    expect(
      auctionLotMatchesBike(
        iron,
        lot({
          title: "2019 Harley-Davidson Iron 883 with 12400 miles, restored",
          priceUsd: 6800,
        })
      )
    ).toBe(true);
  });

  it("matches an Iron 883 lot that uses the XL883N code", () => {
    expect(
      auctionLotMatchesBike(
        iron,
        lot({
          title: "2018 Harley-Davidson XL883N Iron 883",
          model: "XL883N Iron 883",
          modelYear: 2018,
          priceUsd: 6400,
        })
      )
    ).toBe(true);
  });

  it("keeps Street Glide and Street Glide Special apart", () => {
    const glide = lot({
      title: "2016 Harley-Davidson Street Glide",
      model: "Street Glide",
      priceUsd: 12000,
    });
    const special = lot({
      title: "2016 Harley-Davidson Street Glide Special",
      model: "Street Glide Special",
      priceUsd: 14000,
    });
    expect(
      auctionLotMatchesBike(
        { year: 2016, make: "Harley-Davidson", model: "Street Glide" },
        special
      )
    ).toBe(false);
    expect(
      auctionLotMatchesBike(
        { year: 2016, make: "Harley-Davidson", model: "Street Glide Special" },
        glide
      )
    ).toBe(false);
    expect(
      auctionLotMatchesBike(
        { year: 2016, make: "Harley-Davidson", model: "Street Glide" },
        glide
      )
    ).toBe(true);
  });

  it("does not mix Ninja 650 with Versys 650 or CB500F with CB500X", () => {
    expect(
      auctionLotMatchesBike(
        { year: 2020, make: "Kawasaki", model: "Ninja 650" },
        lot({
          make: "Kawasaki",
          model: "Versys 650",
          title: "2020 Kawasaki Versys 650",
          priceUsd: 5000,
        })
      )
    ).toBe(false);
    expect(
      auctionLotMatchesBike(
        { year: 2020, make: "Kawasaki", model: "Ninja 650" },
        lot({
          make: "Kawasaki",
          model: "EX650",
          title: "2020 Kawasaki EX650 Ninja 650",
          priceUsd: 5200,
        })
      )
    ).toBe(true);
    expect(
      auctionLotMatchesBike(
        { year: 2021, make: "Honda", model: "CB500F" },
        lot({
          make: "Honda",
          model: "CB500X",
          title: "2021 Honda CB500X",
          priceUsd: 4800,
        })
      )
    ).toBe(false);
  });

  it("matches MT-07 written with or without a hyphen, and not MT-09", () => {
    const bike = { year: 2022, make: "Yamaha", model: "MT-07" };
    expect(
      auctionLotMatchesBike(
        bike,
        lot({ make: "Yamaha", model: "MT07", title: "2022 Yamaha MT07", priceUsd: 6000 })
      )
    ).toBe(true);
    expect(
      auctionLotMatchesBike(
        bike,
        lot({
          make: "Yamaha",
          model: "MT-09",
          title: "2022 Yamaha MT-09",
          priceUsd: 8000,
        })
      )
    ).toBe(false);
  });
});

describe("auction price summary", () => {
  it("uses the median of sold prices and ignores unsold lots", () => {
    expect(median([100, 400, 200, 300])).toBe(250);
    const guide = guideFrom({
      bike: iron,
      lots: [
        lot({ title: "a", priceUsd: 4000, saleDate: "2022-01-01" }),
        lot({ title: "b", priceUsd: 8000, saleDate: "2023-01-01" }),
        lot({ title: "c", priceUsd: 6000, saleDate: "2024-01-01" }),
        lot({
          title: "unsold",
          priceUsd: 20000,
          status: "unsold",
          saleDate: "2024-05-01",
        }),
        lot({
          title: "other make",
          make: "Ducati",
          model: "Monster",
          priceUsd: 9000,
          saleDate: "2024-05-01",
        }),
      ],
      truncated: false,
      altfnConfigured: true,
      providerMessage: null,
      fetchedAt: "2026-11-02T00:00:00.000Z",
      providerFailed: false,
    });

    expect(guide.state).toBe("ready");
    expect(guide.overallCount).toBe(3);
    expect(guide.modelYearScope).toBe("model_year");
    expect(guide.modelYearMedianCad).toBe(6000);
    expect(guide.modelYearLowCad).toBe(4000);
    expect(guide.modelYearHighCad).toBe(8000);
    expect(guide.history.map((point) => point.saleYear)).toEqual([2022, 2023, 2024]);
    expect(guide.comps).toHaveLength(3);
    expect(guide.comps[0].title).toBe("c");
  });

  it("widens to one model year when the exact year has a single sale", () => {
    const guide = guideFrom({
      bike: iron,
      lots: [
        lot({
          title: "2018 Iron 883",
          modelYear: 2018,
          priceUsd: 5000,
          saleDate: "2020-04-01",
        }),
        lot({
          title: "2020 Iron 883",
          modelYear: 2020,
          priceUsd: 7000,
          saleDate: "2021-04-01",
        }),
      ],
      truncated: false,
      altfnConfigured: true,
      providerMessage: null,
      fetchedAt: null,
      providerFailed: false,
    });
    expect(guide.modelYearScope).toBe("nearby_year");
    expect(guide.modelYearMedianCad).toBe(6000);
    const view = presentAuctionPriceGuide(guide, "customer");
    expect(view.headline).toContain("within one model year of 2019");
    expect(view.headline).toContain("$6,000");
    expect(view.headline).not.toContain("US$");
    expect(view.disclaimer).toContain("Canadian dollars");
    expect(view.disclaimer).toContain("Bank of Canada");
    expect(view.sourceLine).toContain("Canadian dollars");
  });

  it("prices the model across years when nearby years are also thin", () => {
    const guide = guideFrom({
      bike: iron,
      lots: [
        lot({
          title: "2008 Iron 883",
          modelYear: 2008,
          priceUsd: 3000,
          saleDate: "2010-01-01",
        }),
        lot({
          title: "2010 Iron 883",
          modelYear: 2010,
          priceUsd: 5000,
          saleDate: "2012-01-01",
        }),
      ],
      truncated: false,
      altfnConfigured: true,
      providerMessage: null,
      fetchedAt: null,
      providerFailed: false,
    });
    expect(guide.modelYearScope).toBe("all_years");
    const view = presentAuctionPriceGuide(guide, "customer");
    expect(view.headline).toContain("this model");
    expect(view.detail).toContain("2010 to 2012");
  });

  it("hides setup instructions from the customer when the feed is not connected", () => {
    const guide = guideFrom({
      bike: iron,
      lots: [],
      truncated: false,
      altfnConfigured: false,
      providerMessage: null,
      fetchedAt: null,
      providerFailed: false,
    });
    const customer = presentAuctionPriceGuide(guide, "customer");
    const staff = presentAuctionPriceGuide(guide, "staff");
    expect(customer.headline).toBe("Auction prices are not available yet");
    expect(customer.detail).not.toContain("ALTFNDATA_API_KEY");
    expect(staff.detail).toContain("ALTFNDATA_API_KEY");
    expect(staff.detail).toContain("AWS Data Exchange");
    expect(staff.researchedSources.map((source) => source.id)).toContain(
      "bring_a_trailer"
    );
    expect(staff.appraisalNote).toContain("Canadian Black Book");
  });

  it("keeps only the latest sale years visible when history is long", () => {
    const lots = Array.from({ length: 20 }, (_, index) =>
      lot({
        title: `Iron 883 ${2004 + index}`,
        priceUsd: 4000 + index,
        saleDate: `${2004 + index}-05-01`,
        sourceLotId: `sale-${index}`,
      })
    );
    const guide = guideFrom({
      bike: iron,
      lots,
      truncated: false,
      altfnConfigured: true,
      providerMessage: null,
      fetchedAt: null,
      providerFailed: false,
    });
    const view = presentAuctionPriceGuide(guide, "staff");
    expect(view.history).toHaveLength(20);
    expect(view.visibleHistory).toHaveLength(16);
    expect(view.visibleHistory[0].saleYear).toBe(2008);
    expect(view.historyNote).toContain("Earlier sale years");
  });

  it("converts each sale into Canadian dollars before taking the median", () => {
    const guide = guideFrom({
      bike: iron,
      lots: [
        lot({ title: "early", priceUsd: 4000, saleDate: "2022-01-03" }),
        lot({ title: "late", priceUsd: 8000, saleDate: "2024-06-03" }),
      ],
      truncated: false,
      altfnConfigured: true,
      providerMessage: null,
      fetchedAt: null,
      providerFailed: false,
      cadPerUsd: (saleDate) => (saleDate === "2022-01-03" ? 1.25 : 1.4),
    });

    expect(guide.modelYearLowCad).toBe(5000);
    expect(guide.modelYearHighCad).toBe(11200);
    expect(guide.modelYearMedianCad).toBe(8100);
    expect(guide.history).toEqual([
      { saleYear: 2022, medianCad: 5000, count: 1 },
      { saleYear: 2024, medianCad: 11200, count: 1 },
    ]);
    expect(guide.comps.map((sale) => sale.priceCad).sort((a, b) => a - b)).toEqual([
      5000, 11200,
    ]);
    const view = presentAuctionPriceGuide(guide, "customer");
    expect(view.headline).toContain("$8,100");
    expect(view.detail).toContain("$5,000");
    expect(view.detail).toContain("$11,200");
    expect(view.disclaimer).toContain("monthly average");
  });

  it("puts the Canadian typical price on the inspection report", () => {
    const priced = guideFrom({
      bike: iron,
      lots: [
        lot({ title: "early", priceUsd: 4000, saleDate: "2022-01-03" }),
        lot({ title: "late", priceUsd: 8000, saleDate: "2024-06-03" }),
      ],
      truncated: false,
      altfnConfigured: true,
      providerMessage: null,
      fetchedAt: null,
      providerFailed: false,
      cadPerUsd: (saleDate) => (saleDate === "2022-01-03" ? 1.25 : 1.4),
    });
    expect(inspectionAuctionCallout(presentAuctionPriceGuide(priced, "staff"))).toEqual({
      amount: "$8,100",
      range: "$5,000 to $11,200",
      caption: "Typical auction price in Canadian dollars",
      historyNote: null,
      points: [
        { saleYear: 2022, medianCad: 5000, count: 1, amount: "$5,000" },
        { saleYear: 2024, medianCad: 11200, count: 1, amount: "$11,200" },
      ],
    });

    const empty = guideFrom({
      bike: iron,
      lots: [],
      truncated: false,
      altfnConfigured: false,
      providerMessage: null,
      fetchedAt: null,
      providerFailed: false,
    });
    expect(inspectionAuctionCallout(presentAuctionPriceGuide(empty, "staff"))).toBeNull();
  });
});

describe("ALT/FNDATA records", () => {
  it("maps a sold lot and drops unsafe links", () => {
    const mapped = mapAltfnMotorcycleRow({
      item_title: "2019 Harley-Davidson Iron 883",
      manufacturer_name: "Harley-Davidson",
      model: "Iron 883",
      production_year: "2019",
      vendor: "Mecum",
      sale_price: 7000,
      sale_currency: "USD",
      usd_price_decimal: 7500,
      sale_date: "2024-01-15T18:00:00Z",
      sale_location: "Las Vegas",
      sale_location_country: "United States",
      status: "Sold",
      lot_url: "javascript:alert(1)",
    });
    expect(mapped?.priceUsd).toBe(7500);
    expect(mapped?.status).toBe("sold");
    expect(mapped?.saleDate).toBe("2024-01-15");
    expect(mapped?.lotUrl).toBeNull();
    expect(safeHttpUrl("https://example.com/lot")).toBe("https://example.com/lot");
  });

  it("does not treat a pound hammer as US dollars", () => {
    const mapped = mapAltfnMotorcycleRow({
      item_title: "1951 Vincent Black Lightning",
      manufacturer_name: "Vincent",
      model: "Black Lightning",
      production_year: "1951",
      sale_price: 500000,
      sale_currency: "GBP",
      status: "Sold",
    });
    expect(mapped?.priceUsd).toBeNull();
    expect(mapped?.hammerCurrency).toBe("GBP");
  });

  it("imports ALT/FNDATA JSON and a generic CSV", () => {
    const json = recordsFromAuctionFile(
      JSON.stringify({
        data: [
          {
            item_title: "2019 Harley-Davidson Iron 883",
            manufacturer_name: "Harley-Davidson",
            model: "Iron 883",
            production_year: "2019",
            usd_price_decimal: "6,400",
            sale_currency: "USD",
            sale_date: "2023-08-01",
            status: "Sold",
            vendor: "Bonhams",
          },
        ],
      }),
      "altfndata"
    );
    expect(json).toHaveLength(1);
    expect(json[0].priceUsd).toBe(6400);
    expect(json[0].vendor).toBe("Bonhams");

    const csv = recordsFromAuctionFile(
      'title,make,model,year,price_usd,sale_date,status,vendor,lot_url\n"2014 Honda CB500F, blue",Honda,CB500F,2014,4500,2022-03-01,sold,Iconic,https://example.com/cb\n',
      "iconic"
    );
    expect(csv).toHaveLength(1);
    expect(csv[0].source).toBe("iconic");
    expect(csv[0].make).toBe("Honda");
    expect(csv[0].priceUsd).toBe(4500);
    expect(csv[0].title).toBe("2014 Honda CB500F, blue");
    expect(csv[0].lotUrl).toBe("https://example.com/cb");
  });

  it("queries the motorcycle table and keeps valuation comps", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes("/valuation")) {
        return new Response(
          JSON.stringify({
            ok: true,
            comps: [
              {
                model: "Iron 883",
                vendor: "Mecum",
                sale_date: "2024-02-02",
                usd_price: 7100,
                lot_url: "https://example.com/comp",
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              item_title: "2019 Harley-Davidson Iron 883",
              manufacturer_name: "Harley-Davidson",
              model: "Iron 883",
              production_year: "2019",
              usd_price_decimal: 6900,
              sale_date: "2023-02-02",
              status: "Sold",
              vendor: "Mecum",
            },
          ],
        }),
        { status: 200 }
      );
    });

    const result = await fetchAltfnMotorcycleLots({
      make: "Harley-Davidson",
      model: "Iron 883",
      apiKey: "test-key",
      makeProbe: "harley",
      modelProbe: "883",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.configured).toBe(true);
    expect(result.failed).toBe(false);
    expect(new Set(result.lots.map((row) => row.priceUsd))).toEqual(
      new Set([6900, 7100])
    );
    const queryCall = fetchImpl.mock.calls.find((call) =>
      String(call[0]).includes("/query")
    );
    const init = queryCall?.[1];
    if (!init?.body) throw new Error("missing auction query");
    const body = JSON.parse(String(init.body));
    expect(body.filters).toEqual(
      expect.arrayContaining([
        { field: "manufacturer_name", op: "like", value: "harley" },
        { field: "model", op: "like", value: "883" },
      ])
    );
    expect(String(queryCall?.[0])).not.toContain("test-key");
    expect(String(init.body)).not.toContain("test-key");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
  });

  it("does not call the provider without a key", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchAltfnMotorcycleLots({
      make: "Honda",
      model: "CB500F",
      apiKey: "  ",
      makeProbe: "honda",
      modelProbe: "cb500f",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.configured).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("refresh planning", () => {
  const base = {
    force: false,
    hasKey: true,
    snapshotMatches: true,
    snapshotConfigured: true,
    snapshotAgeMs: 1000,
    localSaleCount: 4,
    snapshotSaleCount: 4,
    ttlMs: 10_000,
  };

  it("serves a fresh matching snapshot", () => {
    expect(planAuctionRefresh(base)).toBe("use-snapshot");
  });

  it("waits for the provider on the first lookup", () => {
    expect(planAuctionRefresh({ ...base, snapshotMatches: false })).toBe(
      "await-provider"
    );
  });

  it("rebuilds locally when a file import changes the sale count", () => {
    expect(planAuctionRefresh({ ...base, localSaleCount: 6 })).toBe("rebuild-local");
    expect(planAuctionRefresh({ ...base, hasKey: false, snapshotConfigured: true })).toBe(
      "rebuild-local"
    );
  });

  it("refreshes in the background once the cache is stale", () => {
    expect(planAuctionRefresh({ ...base, snapshotAgeMs: 20_000 })).toBe(
      "snapshot-and-refresh"
    );
  });

  it("calls the provider as soon as a key is added", () => {
    expect(planAuctionRefresh({ ...base, snapshotConfigured: false })).toBe(
      "await-provider"
    );
  });

  it("forces a live lookup from the update button", () => {
    expect(planAuctionRefresh({ ...base, force: true })).toBe("await-provider");
    expect(planAuctionRefresh({ ...base, force: true, hasKey: false })).toBe(
      "rebuild-local"
    );
  });
});

describe("stored guide parsing", () => {
  it("rejects a snapshot that is not a guide", () => {
    expect(parseStoredAuctionGuide({ headline: "nope" })).toBeNull();
  });

  it("rejects a snapshot still priced in US dollars", () => {
    const guide = guideFrom({
      bike: iron,
      lots: [lot({ title: "one", priceUsd: 5000 })],
      truncated: false,
      altfnConfigured: true,
      providerMessage: null,
      fetchedAt: null,
      providerFailed: false,
    });
    const legacy = {
      ...guide,
      modelYearMedianUsd: guide.modelYearMedianCad,
    };
    delete (legacy as { modelYearMedianCad?: number | null }).modelYearMedianCad;
    expect(parseStoredAuctionGuide(legacy)).toBeNull();
    expect(parseStoredAuctionGuide(guide)).toEqual(guide);
  });
});

describe("price guide wiring", () => {
  it("shows the guide on the motorcycle page and the customer portal", () => {
    const motorcyclePage = readFileSync(
      "app/(app)/motorcycles/[motorcycle_id]/page.tsx",
      "utf8"
    );
    const portalPage = readFileSync("app/c/[token]/page.tsx", "utf8");
    const portalClient = readFileSync("components/portal/PortalClient.tsx", "utf8");
    expect(motorcyclePage).toContain("AuctionPriceGuide");
    expect(motorcyclePage).toContain('audience: "staff"');
    expect(portalPage).toContain('audience: "customer"');
    expect(portalClient).toContain('variant="portal"');
    const guideUi = readFileSync("components/auctions/AuctionPriceGuide.tsx", "utf8");
    expect(guideUi).toContain("formatCad");
    expect(guideUi).toContain("Canadian dollars");
    expect(guideUi).not.toContain("formatUsd");
    expect(guideUi).not.toContain("US$");
  });

  it("shows the auction price on the inspection report", () => {
    const inspectionPage = readFileSync(
      "app/(app)/work_orders/[work_order_id]/inspection/page.tsx",
      "utf8"
    );
    const workOrderPage = readFileSync(
      "app/(app)/work_orders/[work_order_id]/page.tsx",
      "utf8"
    );
    const checklist = readFileSync(
      "components/inspections/InspectionChecklist.tsx",
      "utf8"
    );
    expect(inspectionPage).toContain("loadAuctionPriceGuide");
    expect(inspectionPage).toContain("auctionGuide");
    expect(workOrderPage).toContain("loadAuctionPriceGuide");
    expect(workOrderPage).toContain("auctionGuide={auctionGuide}");
    expect(checklist).toContain("InspectionAuctionPrice");
    expect(checklist).toContain("auctionGuide");
    const callout = readFileSync(
      "components/auctions/InspectionAuctionPrice.tsx",
      "utf8"
    );
    expect(callout).toContain("inspection-auction-price");
    expect(callout).toContain("inspection-auction-chart");
    expect(callout).toContain("Auction price by year of sale");
  });
});
