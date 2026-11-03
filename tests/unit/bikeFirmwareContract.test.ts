import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sketch = readFileSync(
  path.join(process.cwd(), "firmware/bike/bike_link.ino"),
  "utf8"
);

describe("bike_link.ino", () => {
  it("asks the ECU at 7DF and does not clear codes", () => {
    expect(sketch).toContain("7DF");
    expect(sketch).toContain("do not clear codes");
    expect(sketch).not.toContain("ClearDTC");
    expect(sketch).toMatch(/readOdometer\(\)[\s\S]{0,240}return "";/);
  });

  it("sets radio power only inside the BIKE_LINK_RADIO guard", () => {
    expect(sketch).toContain("AT+CRFOP=0");
    const unguarded = sketch.replace(
      /#if\s+defined\(BIKE_LINK_RADIO\)[\s\S]*?#endif/g,
      ""
    );
    expect(unguarded).not.toContain("AT+CRFOP=0");
  });
});
