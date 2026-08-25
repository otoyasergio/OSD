import { test, expect } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import { FIXTURE_WORK_ORDER } from "./fixtures/ids";

/**
 * Regression coverage for the two pre-V2 feature bundles: the photo
 * lightbox and the contract initials wizard. Stateful QA only.
 */

test.use({ storageState: storageStatePath("advisor") });

async function openWorkOrder(page: import("@playwright/test").Page) {
  await page.goto("/work_orders");
  await page.getByText(FIXTURE_WORK_ORDER.number).first().click();
  await expect(page).toHaveURL(/\/work_orders\//);
}

test.describe("photo lightbox", () => {
  test("gallery opens, navigates with arrows, and closes with Escape", async ({
    page,
  }) => {
    await openWorkOrder(page);

    const photoButton = page
      .getByRole("button", { name: /photo|front|rear|left|right/i })
      .first();
    if (!(await photoButton.isVisible().catch(() => false))) {
      test.skip(true, "no photos on fixture work order");
    }
    await photoButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/\d+ of \d+/)).toBeVisible();

    const counterBefore = await dialog.getByText(/\d+ of \d+/).innerText();
    await page.keyboard.press("ArrowRight");
    const counterAfter = await dialog.getByText(/\d+ of \d+/).innerText();
    expect(counterAfter).not.toBe(counterBefore);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Focus returns to the trigger.
    await expect(photoButton).toBeFocused();
  });
});

test.describe("contract initials wizard", () => {
  test("each section requires initials before advancing to the signature", async ({
    page,
  }) => {
    await openWorkOrder(page);
    const contractTab = page
      .getByRole("link", { name: /contract/i })
      .or(page.getByRole("tab", { name: /contract/i }))
      .first();
    if (!(await contractTab.isVisible().catch(() => false))) {
      test.skip(true, "contract tab not reachable");
    }
    await contractTab.click();

    const alreadySigned = await page
      .getByText(/signed on paper|signed digitally/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (alreadySigned) {
      // Signed view must list the captured section initials.
      await expect(page.getByText(/section initials/i)).toBeVisible();
      return;
    }

    const progress = page.getByText(/section 1 of/i).first();
    if (!(await progress.isVisible().catch(() => false))) {
      test.skip(true, "wizard not active (template without sections)");
    }

    const next = page.getByRole("button", { name: /next section/i });
    await expect(next).toBeDisabled();

    const initials = page.getByLabel(/initial to confirm/i);
    await initials.fill("QA");
    await expect(next).toBeEnabled();

    // Enter must advance, not submit the signature form.
    await initials.press("Enter");
    await expect(page.getByText(/section 2 of/i)).toBeVisible();
    await expect(page.getByText(/signed digitally/i)).toHaveCount(0);

    // Back preserves the earlier initial.
    await page.getByRole("button", { name: /back/i }).click();
    await expect(page.getByLabel(/initial to confirm/i)).toHaveValue("QA");
  });
});
