/** @vitest-environment jsdom */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ControlCenterData } from "@/lib/services/controlCenter";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ControlCenterShell } from "@/components/control-center/ControlCenterShell";

const data: ControlCenterData = {
  location_id: "loc-tor",
  location_code: "TOR",
  role: "owner",
  subtitle: "Shop pulse",
  pool: [],
  techs: [],
  kpis: [],
  live_summary: "0 bikes",
};

describe("control center stage rows", () => {
  it("puts Waiting for approval above parts and Insurance bikes under Complete", () => {
    const html = renderToStaticMarkup(
      createElement(ControlCenterShell, {
        data,
        canAssign: true,
        waitingForApproval: [],
        waitingForParts: [],
        insuranceBikes: [],
      })
    );

    const approval = html.indexOf("Waiting for approval");
    const parts = html.indexOf("Waiting for parts");
    const complete = html.indexOf(">Complete<");
    const insurance = html.indexOf("Insurance bikes");

    expect(approval).toBeGreaterThan(-1);
    expect(parts).toBeGreaterThan(approval);
    expect(complete).toBeGreaterThan(parts);
    expect(insurance).toBeGreaterThan(complete);
    expect(html).toContain("No bikes waiting for approval.");
    expect(html).toContain("No insurance bikes.");
  });
});
