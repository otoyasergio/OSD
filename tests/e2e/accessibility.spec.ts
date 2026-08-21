import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { storageStatePath } from "./fixtures/auth";
import { FIXTURE_WORK_ORDER } from "./fixtures/ids";

/**
 * Axe accessibility gates for the redesigned surfaces. No contrast
 * exemptions: redesigned screens must pass the full ruleset with zero
 * critical or serious violations. Stateful QA only.
 */

function criticalOrSerious(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]
) {
  return violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious"
  );
}

test.describe("technician surfaces", () => {
  test.use({ storageState: storageStatePath("techA") });

  test("tech floor has no critical or serious violations", async ({ page }) => {
    await page.goto("/technician");
    await expect(page.getByText(/your line|work now|pick a bike/i).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(criticalOrSerious(results.violations)).toEqual([]);
  });

  test("selected bike work surface passes axe", async ({ page }) => {
    await page.goto("/technician");
    const card = page.getByText(FIXTURE_WORK_ORDER.number).first();
    if (!(await card.isVisible().catch(() => false))) {
      test.skip(true, "fixture bike not on the line");
    }
    await card.click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(criticalOrSerious(results.violations)).toEqual([]);
  });
});

test.describe("front office surfaces", () => {
  test.use({ storageState: storageStatePath("advisor") });

  test("estimate workspace passes axe", async ({ page }) => {
    await page.goto("/work_orders");
    await page.getByText(FIXTURE_WORK_ORDER.number).first().click();
    const estimateTab = page
      .getByRole("link", { name: /estimate/i })
      .or(page.getByRole("tab", { name: /estimate/i }))
      .first();
    if (await estimateTab.isVisible().catch(() => false)) {
      await estimateTab.click();
    }
    const results = await new AxeBuilder({ page }).analyze();
    expect(criticalOrSerious(results.violations)).toEqual([]);
  });
});
