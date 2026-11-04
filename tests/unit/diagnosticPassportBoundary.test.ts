import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("public surfaces stay free of shop fault codes", () => {
  it("does not render diagnostic sessions on the public passport or customer portal", () => {
    for (const relativePath of [
      "app/p/[token]/page.tsx",
      "components/passport/PassportReport.tsx",
      "app/c/[token]/page.tsx",
      "components/portal/PortalClient.tsx",
    ]) {
      expect(source(relativePath)).not.toMatch(
        /diagnostic_session|diagnostic_reading|recordedFaultCodes|DiagnosticPanel/
      );
    }
  });
});
