import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("work order page first-pass speed wiring", () => {
  const source = readFileSync(
    join(process.cwd(), "app", "(app)", "work_orders", "[work_order_id]", "page.tsx"),
    "utf8"
  );

  it("keeps request-time rendering", () => {
    expect(source).toContain('export const dynamic = "force-dynamic"');
  });

  it("signs full intake URLs only on the Photos tab", () => {
    expect(source).toMatch(/sign:\s*activeTab === "photos" \? "all" : "thumbs"/);
  });

  it("skips inspection storage signing on Overview and Estimate", () => {
    expect(source).toMatch(/sign:\s*activeTab === "inspection" \? "all" : "none"/);
  });

  it("overlaps id-only reads with getWorkOrderDetail", () => {
    expect(source).toContain("const detailPromise = getWorkOrderDetail");
    expect(source).toMatch(/Promise\.all\(\[\s*detailPromise/);
  });

  it("lazy-loads heavy tab islands without disabling SSR", () => {
    expect(source).toContain('import nextDynamic from "next/dynamic"');
    expect(source).toContain("EstimateJobsWorkspace");
    expect(source).toContain("AskOtomotoPanel");
    expect(source).toContain("ContractSigningPanel");
    expect(source).toContain("SquareInvoicePanel");
    expect(source).toContain("InspectionChecklist");
    expect(source).not.toMatch(/ssr:\s*false/);
  });
});
