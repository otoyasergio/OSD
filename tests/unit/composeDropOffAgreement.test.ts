import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

const require = createRequire(import.meta.url);
const { SHOP, composeDropOffAgreement } =
  require("../../integrations/app-builder-agreement/actions/compose-drop-off-agreement/compose.js") as {
    SHOP: { legalName: string; address: string; phone: string; hours: string };
    composeDropOffAgreement: (input: Record<string, unknown>) => {
      statusCode: number;
      body: {
        error?: string;
        customerDocumentTitle?: string;
        issuer?: { legalName: string; address: string; phone: string };
        documentGenerationData?: { bodyHtml: string };
      };
    };
  };

const packet = {
  work_order_number: "WO-1042",
  signer_name: "Ada Lovelace",
  signed_at: "2026-07-12T15:04:00.000Z",
  template_version: "2026-07-12-legal",
  template_title: "Legal Terms and Conditions",
};

describe("compose drop-off agreement action", () => {
  it("stamps the same Toronto shop facts the app already sends to customers", () => {
    expect(SHOP.legalName).toBe(TORONTO_SHOP.legalName);
    expect(SHOP.phone).toBe(TORONTO_SHOP.phoneDisplay);
    expect(SHOP.address).toBe(`${TORONTO_SHOP.fullAddress}, Canada`);
    expect(SHOP.hours).toBe(`${TORONTO_SHOP.hours}, ${TORONTO_SHOP.sunday}`);
  });

  it("accepts the published legal contract and uses the customer-document title", () => {
    const bodyHtml = readFileSync(
      path.join(process.cwd(), "scripts/data/otomoto-legal-contract.html"),
      "utf8"
    );

    const result = composeDropOffAgreement({ ...packet, body_html: bodyHtml });

    expect(result.statusCode).toBe(200);
    expect(result.body.customerDocumentTitle).toBe(
      "Drop-off agreement — WO-1042 (2026-07-12)"
    );
    expect(result.body.issuer?.legalName).toBe("OTOMOTO TORONTO MOTO INC.");
    expect(result.body.documentGenerationData?.bodyHtml).toContain(
      "Otomoto Toronto Moto Inc."
    );
  });

  it("rejects the seeded trade-name drop-off template", () => {
    const result = composeDropOffAgreement({
      ...packet,
      template_version: "2026-07-01",
      template_title: "Motorcycle Drop-Off & Service Agreement",
      body_html:
        "<h2>Toronto Moto — Drop-Off Agreement</h2><p>By signing below, the customer acknowledges and agrees to the following terms for motorcycle service at Toronto Moto.</p>",
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error).toContain("trade name");
  });
});
