import { describe, expect, it } from "vitest";
import {
  isServiceInfoEmpty,
  mapFitmentToServiceInfo,
  mergeServiceInfoFill,
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
});

describe("isServiceInfoEmpty", () => {
  it("is true when all mapped fields blank", () => {
    expect(isServiceInfoEmpty(null)).toBe(true);
    expect(isServiceInfoEmpty({ oil_filter: "  " })).toBe(true);
    expect(isServiceInfoEmpty({ oil_filter: "HF160" })).toBe(false);
  });
});
