import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseContractSections } from "@/lib/contracts/parseContractSections";

const LEGAL_CONTRACT_HTML = readFileSync(
  resolve(__dirname, "../../scripts/data/otomoto-legal-contract.html"),
  "utf8"
);

describe("parseContractSections", () => {
  it("returns null when the HTML has no data-initial sections", () => {
    expect(parseContractSections("<p>Plain agreement text</p>")).toBeNull();
    expect(
      parseContractSections("<section><h3>Terms</h3><p>Body</p></section>")
    ).toBeNull();
  });

  it("splits the shop legal contract into 11 initialed steps", () => {
    const parsed = parseContractSections(LEGAL_CONTRACT_HTML);
    expect(parsed).not.toBeNull();
    expect(parsed!.steps.map((s) => s.key)).toEqual([
      "terms_warning",
      "maintenance",
      "pickup",
      "ride_move",
      "liability",
      "media",
      "payment",
      "ownership",
      "fuel",
      "ai_privacy",
      "acknowledgement",
    ]);
  });

  it("extracts section headings", () => {
    const parsed = parseContractSections(LEGAL_CONTRACT_HTML)!;
    expect(parsed.steps[0].heading).toBe("1. Agreement");
    expect(parsed.steps[2].heading).toBe(
      "3. Prompt Pick-up of Motorcycle after Notification"
    );
    expect(parsed.steps[10].heading).toBe("13. Acknowledgement");
  });

  it("merges the preamble into the first step", () => {
    const parsed = parseContractSections(LEGAL_CONTRACT_HTML)!;
    expect(parsed.steps[0].html).toContain("Legal Terms and Conditions");
    expect(parsed.steps[0].html).toContain("WILL AFFECT YOUR LEGAL RIGHTS");
    expect(parsed.steps[0].html).toContain("1. Agreement");
  });

  it("merges plain sections into the following initialed step", () => {
    const parsed = parseContractSections(LEGAL_CONTRACT_HTML)!;
    const aiPrivacy = parsed.steps.find((s) => s.key === "ai_privacy")!;
    expect(aiPrivacy.html).toContain("10. Miscellaneous");
    expect(aiPrivacy.html).toContain("11. Entire Agreement");
    // Plain sections belong to exactly one step.
    const fuel = parsed.steps.find((s) => s.key === "fuel")!;
    expect(fuel.html).not.toContain("10. Miscellaneous");
  });

  it("returns trailing content after the last initialed section", () => {
    const parsed = parseContractSections(LEGAL_CONTRACT_HTML)!;
    expect(parsed.trailingHtml).toContain(
      "Customer signature, printed name, and date are captured below."
    );
    for (const step of parsed.steps) {
      expect(step.html).not.toContain("captured below");
    }
  });

  it("handles single-quoted and spaced data-initial attributes", () => {
    const parsed = parseContractSections(
      `<section data-initial = 'alpha beta'><h2>A</h2><p>x</p></section>`
    )!;
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0].key).toBe("alpha beta");
    expect(parsed.steps[0].heading).toBe("A");
  });
});
