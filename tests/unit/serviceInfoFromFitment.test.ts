import { describe, expect, it } from "vitest";
import {
  buildServiceInfoFromFitmentRows,
  fitmentModelAffinity,
  isFitmentOwnedValue,
  isServiceInfoEmpty,
  mapFitmentToServiceInfo,
  mergeServiceInfoFill,
  normalizeFitmentMakeKey,
  pickBestFitmentVehicle,
} from "@/lib/fitment/serviceInfoFromFitment";

describe("mapFitmentToServiceInfo", () => {
  it("maps oil filter, plugs, tires and battery from fitment payload", () => {
    const mapped = mapFitmentToServiceInfo({
      spec_data: {
        chain: "Shaft",
        battery: "YTX14-BS",
        ngkPlug: "LMAR8AI-10",
        rearTireSize: "170/60-17",
        frontTireSize: "120/70-19",
        recommendedOil: "5W-30",
      },
      part_data: {
        oilFilterHF: "HF160",
        oilFilterKN: "0712-0104",
        airFilterHFA: "HFA7914",
        brakePadRear: "010-2092",
      },
    });

    expect(mapped.oil_filter).toBe("HF160 / 0712-0104");
    expect(mapped.oil_type).toBe("5W-30");
    expect(mapped.air_filter).toBe("HFA7914");
    expect(mapped.spark_plugs).toBe("LMAR8AI-10");
    expect(mapped.rear_brake_pads).toBe("010-2092");
    expect(mapped.front_tire_size).toBe("120/70-19");
    expect(mapped.battery).toBe("YTX14-BS");
    expect(mapped.chain).toBe("Shaft");
  });
});

describe("mergeServiceInfoFill", () => {
  it("does not overwrite existing values", () => {
    const { next, filledCount } = mergeServiceInfoFill(
      { oil_filter: "CUSTOM", oil_type: null },
      {
        oil_filter: "HF160",
        oil_type: "5W-30",
        oil_capacity: null,
        air_filter: null,
        spark_plugs: null,
        front_brake_pads: null,
        rear_brake_pads: null,
        front_tire_size: null,
        rear_tire_size: null,
        chain: null,
        battery: null,
      }
    );

    expect(next.oil_filter).toBe("CUSTOM");
    expect(next.oil_type).toBe("5W-30");
    expect(filledCount).toBe(1);
  });

  it("refreshes fitment-owned values when catalogue grows", () => {
    const { next, filledCount } = mergeServiceInfoFill(
      { oil_filter: "HF204", oil_type: "10W-40" },
      {
        oil_filter: "HF204 / KN-204",
        oil_type: "10W-40",
        oil_capacity: null,
        air_filter: "HFA4303",
        spark_plugs: null,
        front_brake_pads: null,
        rear_brake_pads: null,
        front_tire_size: null,
        rear_tire_size: null,
        chain: null,
        battery: null,
      },
      { refreshFitmentValues: true }
    );

    expect(next.oil_filter).toBe("HF204 / KN-204");
    expect(next.air_filter).toBe("HFA4303");
    expect(filledCount).toBe(2);
  });

  it("does not refresh custom staff values", () => {
    const { next, filledCount } = mergeServiceInfoFill(
      { oil_filter: "SHOP-CUSTOM" },
      {
        oil_filter: "HF204",
        oil_type: null,
        oil_capacity: null,
        air_filter: null,
        spark_plugs: null,
        front_brake_pads: null,
        rear_brake_pads: null,
        front_tire_size: null,
        rear_tire_size: null,
        chain: null,
        battery: null,
      },
      { refreshFitmentValues: true }
    );

    expect(next.oil_filter).toBe("SHOP-CUSTOM");
    expect(filledCount).toBe(0);
  });
});

describe("fitmentModelAffinity", () => {
  it("matches R3 aliases used in the catalogue", () => {
    expect(fitmentModelAffinity("R3", "R3")).toBe(100);
    expect(fitmentModelAffinity("R3", "YZF-R3")).toBeGreaterThan(0);
    expect(fitmentModelAffinity("R3", "YZFR3 R-3")).toBeGreaterThan(0);
    expect(fitmentModelAffinity("R3", "R25/R3")).toBe(0);
    expect(fitmentModelAffinity("R3", "R1250GS")).toBe(0);
  });

  it("matches nickname, token, and trim variants", () => {
    expect(fitmentModelAffinity("NPS50 (Ruckus)", "Ruckus")).toBeGreaterThan(0);
    expect(
      fitmentModelAffinity("VT750 (Shadow Spirit 750)", "VT750 C2 Shadow Spirit")
    ).toBeGreaterThan(0);
    expect(fitmentModelAffinity("V-Strom 1000", "DL1000 V-Strom")).toBeGreaterThan(0);
    expect(fitmentModelAffinity("Ninja 500 SE", "EX500 Ninja 500")).toBeGreaterThan(0);
  });

  it("matches Ducati Monster short codes to catalogue family names", () => {
    expect(fitmentModelAffinity("M750", "750 Monster (all)")).toBeGreaterThan(0);
    expect(fitmentModelAffinity("900M", "900 Monster")).toBeGreaterThan(0);
    expect(fitmentModelAffinity("900M", "900M Monster/S/ Cromo/ City")).toBeGreaterThan(
      0
    );
    // Same displacement, different family — must not match
    expect(fitmentModelAffinity("M750", "750 SS")).toBe(0);
    expect(fitmentModelAffinity("M750", "Supersport 750")).toBe(0);
    expect(fitmentModelAffinity("M750", "400 Monster (Japan Only)")).toBe(0);
  });
});

describe("buildServiceInfoFromFitmentRows Ducati short codes", () => {
  it("fills M750 from 750 Monster catalogue row", () => {
    const mapped = buildServiceInfoFromFitmentRows(
      [
        {
          make: "DUCATI",
          model: "750 Monster (all)",
          year_start: 1997,
          year_end: 2002,
          spec_data: {
            chain: "530x100",
            battery: "YB16AL-A2",
            ngkPlug: "DPR8EA-9",
            rearTireSize: "160/70-17",
            frontTireSize: "120/70-17",
            recommendedOil: "15W-50",
          },
          part_data: {
            oilFilterHF: "HF153",
            oilFilterKN: "10-99200",
            airFilterHFA: "HFA6002",
            brakePadRear: "010-047",
            brakePadFront: "1721-1450",
          },
        },
        {
          make: "DUCATI",
          model: "750 SS",
          year_start: 1991,
          year_end: 2002,
          spec_data: {},
          part_data: { oilFilterHF: "HF153", airFilterHFA: "HFA6002" },
        },
      ],
      1999,
      "DUCATI",
      "M750"
    );

    expect(mapped?.oil_filter).toContain("HF153");
    expect(mapped?.oil_type).toBe("15W-50");
    expect(mapped?.air_filter).toContain("HFA6002");
    expect(mapped?.spark_plugs).toBe("DPR8EA-9");
    expect(mapped?.front_brake_pads).toBe("1721-1450");
    expect(mapped?.rear_brake_pads).toBe("010-047");
    expect(mapped?.front_tire_size).toBe("120/70-17");
    expect(mapped?.battery).toContain("YB16AL-A2");
  });
});

const xdiavelCatalogue = [
  {
    make: "DUCATI",
    model: "Diavel",
    year_start: 2011,
    year_end: 2018,
    spec_data: {
      chain: "525x118",
      recommendedOil: "15W-50",
      frontTireSize: "120/70-17",
    },
    part_data: { oilFilterHF: "HF153", airFilterKN: "1011-1281" },
  },
  {
    make: "DUCATI",
    model: "Xdiavel",
    year_start: 2016,
    year_end: 2019,
    spec_data: {
      chain: "Belt",
      battery: "YT12B-BS",
      recommendedOil: "15W-50",
      frontTireSize: "120/70-17",
      rearTireSize: "240/45-17",
    },
    part_data: { oilFilterHF: "HF153", oilFilterKN: "10-99200", airFilterKN: "DU-1112" },
  },
  {
    make: "DUCATI",
    model: "XDiavel S",
    year_start: 2022,
    year_end: 2023,
    spec_data: { forkSealKit: "55-158" },
    part_data: { wheelBearingFront: "25-1404" },
  },
  {
    make: "DUCATI",
    model: "XDiavel V4",
    year_start: 2025,
    year_end: 2025,
    spec_data: { forkSealKit: "55-158" },
    part_data: { wheelBearingFront: "25-1404" },
  },
];

describe("buildServiceInfoFromFitmentRows year carry-forward", () => {
  it("fills a newer XDiavel from last-known Xdiavel service data", () => {
    const mapped = buildServiceInfoFromFitmentRows(
      xdiavelCatalogue,
      2026,
      "DUCATI",
      "XDiavel"
    );

    expect(mapped?.oil_filter).toContain("HF153");
    expect(mapped?.oil_type).toBe("15W-50");
    expect(mapped?.air_filter).toBe("DU-1112");
    expect(mapped?.chain).toBe("Belt");
    expect(mapped?.battery).toContain("YT12B-BS");
    expect(mapped?.front_tire_size).toBe("120/70-17");
    expect(mapped?.rear_tire_size).toBe("240/45-17");
    expect(mapped?.air_filter).not.toContain("1011-1281");
    expect(mapped?.chain).not.toContain("525");
  });

  it("still fills XDiavel when the current-year catalogue row has no service parts", () => {
    const mapped = buildServiceInfoFromFitmentRows(
      xdiavelCatalogue,
      2025,
      "DUCATI",
      "XDiavel"
    );

    expect(mapped?.oil_filter).toContain("HF153");
    expect(mapped?.chain).toBe("Belt");
    expect(mapped?.air_filter).toBe("DU-1112");
  });

  it("does not carry older Xdiavel parts onto an explicit XDiavel V4", () => {
    const mapped = buildServiceInfoFromFitmentRows(
      xdiavelCatalogue,
      2026,
      "DUCATI",
      "XDiavel V4"
    );

    expect(mapped?.oil_filter ?? null).toBeNull();
    expect(mapped?.chain ?? null).toBeNull();
    expect(mapped?.air_filter ?? null).toBeNull();
  });
});

describe("normalizeFitmentMakeKey", () => {
  it("treats VIN make suffixes and hyphenation as the same catalogue make", () => {
    expect(normalizeFitmentMakeKey("INDIAN MOTORCYCLE")).toBe(
      normalizeFitmentMakeKey("INDIAN")
    );
    expect(normalizeFitmentMakeKey("Harley Davidson")).toBe(
      normalizeFitmentMakeKey("HARLEY-DAVIDSON")
    );
  });
});

describe("buildServiceInfoFromFitmentRows make aliases", () => {
  it("fills Scout Sixty when the bike make is INDIAN MOTORCYCLE", () => {
    const mapped = buildServiceInfoFromFitmentRows(
      [
        {
          make: "INDIAN",
          model: "Scout Sixty",
          year_start: 2016,
          year_end: 2024,
          spec_data: { recommendedOil: "20W-40", battery: "YTX14AH" },
          part_data: { oilFilterHF: "HF199" },
        },
      ],
      2016,
      "INDIAN MOTORCYCLE",
      "Scout Sixty"
    );

    expect(mapped?.oil_filter).toBe("HF199");
    expect(mapped?.oil_type).toBe("20W-40");
    expect(mapped?.battery).toContain("YTX14AH");
  });
});

describe("pickBestFitmentVehicle", () => {
  it("prefers normalized model match with richest data", () => {
    const pick = pickBestFitmentVehicle(
      [
        {
          make: "BMW",
          model: "R1250GS",
          year_start: 2019,
          year_end: 2022,
          spec_data: { battery: "YTX14H-BS" },
          part_data: {},
        },
        {
          make: "BMW",
          model: "R 1250 GS",
          year_start: 2017,
          year_end: 2021,
          spec_data: { battery: "YTX14-BS", recommendedOil: "5W-30" },
          part_data: { oilFilterHF: "HF160", airFilterHFA: "HFA7914" },
        },
      ],
      2019,
      "BMW",
      "R 1250 GS"
    );

    expect(pick?.model).toBe("R 1250 GS");
    expect(pick?.part_data.oilFilterHF).toBe("HF160");
  });

  it("does not fill from a different model of the same make", () => {
    const pick = pickBestFitmentVehicle(
      [
        {
          make: "BMW",
          model: "R 1250 GS",
          year_start: 2017,
          year_end: 2021,
          spec_data: { battery: "YTX14-BS" },
          part_data: { oilFilterHF: "HF160" },
        },
      ],
      2019,
      "BMW",
      "S 1000 RR"
    );
    expect(pick).toBeNull();
  });

  it("skips sparse exact R3 rows in favor of YZF-R3 service data", () => {
    const pick = pickBestFitmentVehicle(
      [
        {
          make: "Yamaha",
          model: "R3",
          year_start: 2015,
          year_end: 2025,
          spec_data: {},
          part_data: { ohlinFrontFork: "YA 967" },
        },
        {
          make: "Yamaha",
          model: "YZF-R3",
          year_start: 2015,
          year_end: 2023,
          spec_data: {
            battery: "YTZ8V",
            recommendedOil: "10W-40",
            frontTireSize: "110/70-17",
          },
          part_data: { oilFilterHF: "HF204", airFilterHFA: "HFA4303" },
        },
      ],
      2022,
      "Yamaha",
      "R3"
    );

    expect(pick?.model).toBe("YZF-R3");
  });
});

describe("buildServiceInfoFromFitmentRows", () => {
  it("merges R3 alias rows into a complete service card", () => {
    const mapped = buildServiceInfoFromFitmentRows(
      [
        {
          make: "Yamaha",
          model: "R3",
          year_start: 2015,
          year_end: 2025,
          spec_data: {},
          part_data: { ohlinFrontFork: "YA 967" },
        },
        {
          make: "Yamaha",
          model: "YZF-R3",
          year_start: 2015,
          year_end: 2023,
          spec_data: {
            battery: "YTZ8V",
            recommendedOil: "10W-40",
            frontTireSize: "110/70-17",
            rearTireSize: "140/70-17",
            chain: "520x",
          },
          part_data: {
            oilFilterHF: "HF204",
            oilFilterKN: "0712-0550",
            airFilterHFA: "HFA4303",
          },
        },
        {
          make: "Yamaha",
          model: "YZFR3 R-3",
          year_start: 2015,
          year_end: 2025,
          spec_data: { ngkPlug: "CR8E", battery: "YTZ8V" },
          part_data: {
            oilFilterHF: "HF204",
            oilFilterKN: "KN-204",
            brakePadFront: "010-663",
            brakePadRear: "010-662",
          },
        },
      ],
      2022,
      "Yamaha",
      "R3"
    );

    expect(mapped?.oil_filter).toContain("HF204");
    expect(mapped?.oil_type).toBe("10W-40");
    expect(mapped?.air_filter).toContain("HFA4303");
    expect(mapped?.spark_plugs).toBe("CR8E");
    expect(mapped?.front_brake_pads).toBe("010-663");
    expect(mapped?.rear_brake_pads).toBe("010-662");
    expect(mapped?.front_tire_size).toBe("110/70-17");
    expect(mapped?.battery).toContain("YTZ8V");
  });
});

describe("isFitmentOwnedValue", () => {
  it("recognizes prior autofill tokens", () => {
    expect(isFitmentOwnedValue("HF204", "HF204 / KN-204")).toBe(true);
    expect(isFitmentOwnedValue("SHOP-CUSTOM", "HF204")).toBe(false);
  });
});

describe("isServiceInfoEmpty", () => {
  it("is true when all mapped fields blank", () => {
    expect(isServiceInfoEmpty(null)).toBe(true);
    expect(isServiceInfoEmpty({ oil_filter: "  " })).toBe(true);
    expect(isServiceInfoEmpty({ oil_filter: "HF160" })).toBe(false);
  });
});
