import { describe, expect, it } from "vitest";
import {
  buildAddressSearchTerm,
  normalizeAddressSuggestions,
  normalizeGeoapifySuggestions,
} from "@/lib/address/suggestions";

describe("address suggestions", () => {
  it("expands common abbreviations and biases short searches to Toronto", () => {
    expect(buildAddressSearchTerm("123 Queen St W")).toBe(
      "123 Queen Street West, Toronto, ON"
    );
  });

  it("keeps a city supplied after a comma", () => {
    expect(buildAddressSearchTerm("100 Main Rd, Ottawa, ON")).toBe(
      "100 Main Road, Ottawa, ON"
    );
  });

  it("returns unique street suggestions with exact addresses first", () => {
    const result = normalizeAddressSuggestions([
      {
        title: "Queen Street West, City Of Toronto, Ontario",
        qualifier: "INTERPOLATED_CENTROID",
        type: "ca.gc.nrcan.geoloc.data.model.Street",
      },
      {
        title: "123 Queen Street West, City Of Toronto, Ontario",
        qualifier: "INTERPOLATED_POSITION",
        type: "ca.gc.nrcan.geoloc.data.model.Street",
      },
      {
        title: "123 Queen Street West, City Of Toronto, Ontario",
        qualifier: "INTERPOLATED_POSITION",
        type: "ca.gc.nrcan.geoloc.data.model.Street",
      },
      {
        title: "Queen Lake, Ontario",
        qualifier: "LOCATION",
        type: "ca.gc.nrcan.geoloc.data.model.Geoname",
      },
    ]);

    expect(result).toEqual([
      {
        label: "123 Queen Street West, City Of Toronto, Ontario",
        postalCode: "",
      },
    ]);
  });

  it("keeps exact Geoapify addresses that include a postal code", () => {
    expect(
      normalizeGeoapifySuggestions({
        results: [
          {
            formatted: "123 Queen Street West, Toronto, ON M5H 2M9, Canada",
            postcode: "m5h 2m9",
            result_type: "building",
          },
          {
            formatted: "Queen Street West, Toronto, ON, Canada",
            result_type: "street",
          },
          {
            formatted: "Toronto, ON, Canada",
            postcode: "M5H 2M9",
            result_type: "city",
          },
        ],
      })
    ).toEqual([
      {
        label: "123 Queen Street West, Toronto, ON M5H 2M9, Canada",
        postalCode: "M5H 2M9",
      },
    ]);
  });
});
