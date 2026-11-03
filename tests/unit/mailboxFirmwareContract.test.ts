import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sketch = readFileSync(
  path.join(process.cwd(), "firmware/mailbox/mailbox.ino"),
  "utf8"
);
const gitignore = readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
const example = readFileSync(
  path.join(process.cwd(), "firmware/mailbox/secrets.example.h"),
  "utf8"
);

describe("mailbox.ino", () => {
  it("stamps the shop, powers the radio down, and posts with a gitignored secret", () => {
    expect(sketch).toContain("shop_bay");
    expect(sketch).toContain("AT+CRFOP=0");
    expect(sketch).toContain("/api/bike-link/readings");
    expect(sketch).toContain("secrets.h");
    expect(gitignore).toContain("firmware/mailbox/secrets.h");
    expect(example).toContain('WIFI_SSID[] = ""');
    expect(example).toContain('WIFI_PASSWORD[] = ""');
    expect(example).toContain('BIKE_LINK_INGEST_SECRET[] = ""');
    expect(example).not.toMatch(/BIKE_LINK_INGEST_SECRET\[\] = "[^"]+/);
  });
});
