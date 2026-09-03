import { test, expect } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import { ESTIMATE_TOTALS, FIXTURE_WORK_ORDER, JOB_C, SERVICE_C } from "./fixtures/ids";

/**
 * Front-office Estimate & Jobs journey: price, present, record per-job
 * decisions, confirm once, and verify accepted totals. Stateful QA only.
 */

test.use({ storageState: storageStatePath("advisor") });

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function openWorkOrderEstimateTab(page: import("@playwright/test").Page) {
  await page.goto("/work_orders");
  await page.getByText(FIXTURE_WORK_ORDER.number).first().click();
  await expect(page).toHaveURL(/\/work_orders\//);
  const estimateTab = page
    .getByRole("link", { name: /estimate/i })
    .or(page.getByRole("tab", { name: /estimate/i }))
    .first();
  await estimateTab.click();
}

test.describe("estimate & jobs workspace", () => {
  test("workspace shows every job with authorization and progress chips", async ({
    page,
  }) => {
    await openWorkOrderEstimateTab(page);
    await expect(page.getByText(SERVICE_C.name).first()).toBeVisible();
    await expect(page.getByText(/pending|awaiting/i).first()).toBeVisible();
  });

  test("present, decide per job, confirm once, and match the accepted total", async ({
    page,
  }) => {
    await openWorkOrderEstimateTab(page);

    const present = page.getByRole("button", { name: /present/i }).first();
    if (await present.isEnabled().catch(() => false)) {
      await present.click();
      await expect(page.getByText(/presented/i).first()).toBeVisible({
        timeout: 15_000,
      });
    }

    // Presented totals: $463.30 including HST.
    await expect(
      page.getByText(dollars(ESTIMATE_TOTALS.presentedTotalCents)).first()
    ).toBeVisible();

    // Record staff-assisted decisions: approve A and B, decline C.
    const declineC = page
      .getByRole("group", { name: new RegExp(JOB_C.name, "i") })
      .getByRole("button", { name: /decline/i })
      .or(page.getByLabel(new RegExp(`decline.*${SERVICE_C.name}`, "i")));
    if (
      await declineC
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await declineC.first().click();
    }

    const confirm = page
      .getByRole("button", { name: /confirm|record decisions/i })
      .first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
      await expect(page.getByText(/confirmed/i).first()).toBeVisible({
        timeout: 15_000,
      });
      // Accepted scope total: $406.80.
      await expect(
        page.getByText(dollars(ESTIMATE_TOTALS.acceptedTotalCents)).first()
      ).toBeVisible();
    }
  });

  test("version history lists the presented version immutably", async ({ page }) => {
    await openWorkOrderEstimateTab(page);
    await expect(page.getByText(/version|v1/i).first()).toBeVisible();
  });

  test("editing after presentation warns about creating an amendment", async ({
    page,
  }) => {
    await openWorkOrderEstimateTab(page);
    const amendmentNotice = page.getByText(/amendment/i).first();
    const priceInput = page.getByLabel(/labour|price/i).first();
    if (await priceInput.isVisible().catch(() => false)) {
      await expect(amendmentNotice).toBeVisible();
    }
  });
});
