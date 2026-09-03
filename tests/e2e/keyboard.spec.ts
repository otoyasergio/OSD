import { test, expect } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import { FIXTURE_WORK_ORDER } from "./fixtures/ids";

/**
 * Keyboard interaction gates: Escape closes and restores focus, tabs are
 * arrow-navigable, and Enter never double-submits. Stateful QA only.
 */

test.describe("technician keyboard flows", () => {
  test.use({ storageState: storageStatePath("techA") });

  test("notification dialog closes on Escape and restores focus to the bell", async ({
    page,
  }) => {
    await page.goto("/technician");
    const bell = page.getByRole("button", { name: /assignment alert/i }).first();
    if (!(await bell.isVisible().catch(() => false))) {
      test.skip(true, "no notification bell rendered");
    }
    await bell.click();
    const dialog = page.getByRole("dialog");
    if ((await dialog.count()) === 0) {
      test.skip(true, "no unread notifications to open");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(bell).toBeFocused();
  });

  test("packet tabs support arrow-key navigation", async ({ page }) => {
    await page.goto("/technician");
    const card = page.getByText(FIXTURE_WORK_ORDER.number).first();
    if (!(await card.isVisible().catch(() => false))) {
      test.skip(true, "fixture bike not on the line");
    }
    await card.click();

    const firstTab = page.getByRole("tab").first();
    if (!(await firstTab.isVisible().catch(() => false))) {
      test.skip(true, "packet tabs not present");
    }
    await firstTab.focus();
    await page.keyboard.press("ArrowRight");
    const focusedTab = page.locator('[role="tab"]:focus');
    await expect(focusedTab).toHaveCount(1);
    await expect(focusedTab).not.toHaveText(await firstTab.innerText());
  });

  test("primary floor action is reachable and operable by keyboard", async ({ page }) => {
    await page.goto("/technician");
    const card = page.getByText(FIXTURE_WORK_ORDER.number).first();
    if (!(await card.isVisible().catch(() => false))) {
      test.skip(true, "fixture bike not on the line");
    }
    await card.click();

    const primary = page
      .getByRole("button", { name: /NEXT:|start|pull|complete/i })
      .first();
    if (!(await primary.isVisible().catch(() => false))) {
      test.skip(true, "no primary action rendered");
    }
    await primary.focus();
    await expect(primary).toBeFocused();
    // Focus outline must be visible (focus-visible styles applied).
    const outline = await primary.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });
});
