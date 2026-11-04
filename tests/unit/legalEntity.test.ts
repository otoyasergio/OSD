import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  assertContractNamesLegalEntity,
  contractNamesLegalEntity,
  visibleContractText,
} from "@/lib/contracts/legalEntity";
import { toFormErrorMessage } from "@/lib/services/errors";

const require = createRequire(import.meta.url);
const { composeDropOffAgreement } =
  require("../../integrations/app-builder-agreement/actions/compose-drop-off-agreement/compose.js") as {
    composeDropOffAgreement: (input: Record<string, unknown>) => { statusCode: number };
  };

const packet = {
  work_order_number: "WO-1042",
  signer_name: "Ada Lovelace",
  signed_at: "2026-07-12T15:04:00.000Z",
  template_version: "2026-07-01",
  template_title: "Motorcycle Drop-Off & Service Agreement",
};

const SEEDED_TRADE_NAME =
  "<h2>Toronto Moto — Drop-Off Agreement</h2><p>By signing below, the customer acknowledges and agrees to the following terms for motorcycle service at Toronto Moto.</p>";

describe("contract legal entity", () => {
  it("rejects the original trade-name seed and accepts the published contract", () => {
    const legal = readFileSync(
      path.join(process.cwd(), "scripts/data/otomoto-legal-contract.html"),
      "utf8"
    );
    const corrected =
      "<h2>OTOMOTO TORONTO MOTO INC. — Drop-Off Agreement</h2><p>Service at OTOMOTO TORONTO MOTO INC.</p>";

    expect(contractNamesLegalEntity(SEEDED_TRADE_NAME)).toBe(false);
    expect(contractNamesLegalEntity(legal)).toBe(true);
    expect(contractNamesLegalEntity(corrected)).toBe(true);
    expect(() => assertContractNamesLegalEntity(SEEDED_TRADE_NAME)).toThrow(
      "CONTRACT_LEGAL_ENTITY_REQUIRED"
    );
    expect(toFormErrorMessage(new Error("CONTRACT_LEGAL_ENTITY_REQUIRED"))).toBe(
      "The contract must name OTOMOTO TORONTO MOTO INC. as the contracting party."
    );
  });

  it("counts the legal name only in text a signer can see", () => {
    const scriptOnly =
      "<script>OTOMOTO TORONTO MOTO INC.</script><p>Toronto Moto stores the motorcycle.</p>";
    const attributeOnly =
      '<p title="OTOMOTO TORONTO MOTO INC.">Toronto Moto stores the motorcycle.</p>';
    const split =
      "<p>Otomoto <strong>Toronto</strong>&nbsp;Moto Inc stores the motorcycle.</p>";

    expect(visibleContractText(scriptOnly).toLowerCase()).not.toContain("otomoto");
    expect(visibleContractText(attributeOnly).toLowerCase()).not.toContain("otomoto");
    expect(contractNamesLegalEntity(scriptOnly)).toBe(false);
    expect(contractNamesLegalEntity(attributeOnly)).toBe(false);
    expect(contractNamesLegalEntity(split)).toBe(true);
    expect(() => assertContractNamesLegalEntity(scriptOnly)).toThrow(
      "CONTRACT_LEGAL_ENTITY_REQUIRED"
    );
  });

  it("matches the App Builder action on the same contract bodies", () => {
    for (const bodyHtml of [
      SEEDED_TRADE_NAME,
      "<p>This agreement is made with OTOMOTO TORONTO MOTO INC.</p>",
    ]) {
      const named = contractNamesLegalEntity(bodyHtml);
      const result = composeDropOffAgreement({ ...packet, body_html: bodyHtml });
      expect(result.statusCode === 200).toBe(named);
    }
  });
});
