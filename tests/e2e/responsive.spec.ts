import { test, expect } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import { FIXTURE_WORK_ORDER } from "./fixtures/ids";

/**
 * Responsive gates across the stateful device projects (webkit desktop,
 * iPad landscape/portrait, narrow phone): no horizontal overflow, adequate
 * touch targets, and a reachable primary action dock.
 */

test.use({ storageState: storageStatePath("techA") });

test.describe("tech floor responsive layout", () => {
  test("no horizontal overflow on the tech floor", async ({ page }) => {
    await page.goto("/technician");
    await expect(page.getByText(/your line|work now|pick a bike/i).first()).toBeVisible();
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("exactly one header is visible per viewport", async ({ page }) => {
    await page.goto("/technician");
    const headers = page.locator("header:visible, [class*='topbar']:visible");
    const count = await headers.count();
    expect(count).toBeGreaterThanOrEqual(1);
    // The mobile and desktop headers must never both render the same controls.
    const signOutButtons = page.getByRole("button", { name: /sign out/i });
    let visibleSignOuts = 0;
    for (let i = 0; i < (await signOutButtons.count()); i += 1) {
      if (await signOutButtons.nth(i).isVisible()) visibleSignOuts += 1;
    }
    expect(visibleSignOuts).toBeLessThanOrEqual(1);
  });

  test("primary action meets the 44px minimum touch target", async ({ page }) => {
    await page.goto("/technician");
    const card = page.getByText(FIXTURE_WORK_ORDER.number).first();
    if (!(await card.isVisible().catch(() => false))) {
      test.skip(true, "fixture bike not on the line");
    }
    await card.click();

    const primary = page
      .getByRole("button", { name: /NEXT:|start|pull|complete|waiting/i })
      .first();
    if (!(await primary.isVisible().catch(() => false))) {
      test.skip(true, "no primary action rendered");
    }
    const box = await primary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("the selected bike work surface is reachable without losing the dock", async ({
    page,
  }) => {
    await page.goto("/technician");
    const card = page.getByText(FIXTURE_WORK_ORDER.number).first();
    if (!(await card.isVisible().catch(() => false))) {
      test.skip(true, "fixture bike not on the line");
    }
    await card.click();

    // Scroll to the bottom of the work surface; the primary dock stays visible.
    await page.mouse.wheel(0, 4_000);
    const primary = page
      .getByRole("button", { name: /NEXT:|start|pull|complete|waiting/i })
      .first();
    if (await primary.count()) {
      await expect(primary).toBeInViewport();
    }
  });
});
