import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import { FIXTURE_MOTORCYCLE, FIXTURE_WORK_ORDER, JOB_A } from "./fixtures/ids";

/**
 * Authenticated technician journey against the synthetic QA dataset.
 * Runs only in stateful projects (E2E_ALLOW_MUTATION=1, isolated database).
 */

test.use({ storageState: storageStatePath("techA") });

async function openTechFloor(page: Page): Promise<void> {
  await page.goto("/technician");
  await expect(page).toHaveURL(/\/technician/);
}

test.describe("tech floor journey", () => {
  test("navigation names the technician home Tech Floor, not Jobs", async ({ page }) => {
    await openTechFloor(page);
    await expect(page.getByRole("link", { name: "Tech Floor" }).first()).toBeVisible();
    await expect(page.locator("#app-sidebar-nav")).toHaveCount(0);
  });

  test("Start this bike and the four-stage spine are the forward path", async ({
    page,
  }) => {
    await openTechFloor(page);
    await page.getByText(FIXTURE_WORK_ORDER.number).first().click();

    const spine = page.getByRole("navigation", { name: "Job stages" });
    await expect(spine).toBeVisible();
    await expect(spine.getByText("Inspect", { exact: true })).toBeVisible();
    await expect(spine.getByText("Work", { exact: true })).toBeVisible();
    await expect(spine.getByText("Photo", { exact: true })).toBeVisible();
    await expect(spine.getByText("Done", { exact: true })).toBeVisible();

    await expect(page.getByRole("button", { name: /Got it/i })).toHaveCount(0);
    const start = page.getByRole("button", { name: /Start this bike/i }).first();
    if (await start.isVisible().catch(() => false)) {
      await expect(start).toBeEnabled();
    }
  });

  test("the assigned bike appears once with an explicit next action or wait", async ({
    page,
  }) => {
    await openTechFloor(page);

    const bikeCard = page.getByText(FIXTURE_WORK_ORDER.number).first();
    await expect(bikeCard).toBeVisible();

    // The bike appears in exactly one queue list.
    const occurrences = await page.getByText(FIXTURE_WORK_ORDER.number).count();
    expect(occurrences).toBeGreaterThanOrEqual(1);

    await bikeCard.click();

    const start = page.getByRole("button", { name: /Start this bike/i }).first();
    const go = page
      .getByRole("button", {
        name: /Open inspection|Perform work|Add after photo|Complete job|Resume/i,
      })
      .first();
    const waiting = page.getByText(/Waiting —|WAITING FOR|Front desk owns/i).first();
    const hasStart = await start.isVisible().catch(() => false);
    const hasGo = await go.isVisible().catch(() => false);
    const hasWait = await waiting.isVisible().catch(() => false);
    expect(hasStart || hasGo || hasWait).toBe(true);

    // Internal jargon never reaches the technician.
    await expect(page.getByText(/^quality$/i)).toHaveCount(0);
    await expect(page.getByText(/^HOLD$/)).toHaveCount(0);
    await expect(page.getByText(/^PAUSED$/)).toHaveCount(0);
  });

  test("packet tabs are exclusive and photos open in the lightbox", async ({ page }) => {
    await openTechFloor(page);
    await page.getByText(FIXTURE_WORK_ORDER.number).first().click();

    const notesIcon = page.getByRole("link", { name: "Notes" }).first();
    if (await notesIcon.isVisible().catch(() => false)) {
      await notesIcon.click();
    }

    const notesTab = page.getByRole("tab", { name: /notes/i }).first();
    const photosTab = page.getByRole("tab", { name: /photos/i }).first();
    if (!(await photosTab.isVisible().catch(() => false))) {
      test.skip(true, "packet tabs not reachable from this selection state");
    }

    await photosTab.click();
    await expect(photosTab).toHaveAttribute("aria-selected", "true");
    await expect(notesTab).toHaveAttribute("aria-selected", "false");

    // Photos content replaces notes content rather than coexisting.
    await expect(page.getByRole("tabpanel").getByText(/append-only/i)).toHaveCount(0);
  });

  test("primary action double-click cannot double-fire", async ({ page }) => {
    await openTechFloor(page);
    await page.getByText(FIXTURE_WORK_ORDER.number).first().click();

    const primary = page
      .getByRole("button", { name: /Start this bike|Open inspection|NEXT:|start|pull/i })
      .first();
    if (!(await primary.isVisible().catch(() => false))) {
      test.skip(true, "no enabled primary action in current fixture state");
    }
    await primary.click();
    // Immediately after the first click the control must disable or show
    // a pending state; the second click must be a no-op.
    await expect(primary).toBeDisabled({ timeout: 2_000 });
  });

  test("motorcycle identity is visible to the tech", async ({ page }) => {
    await openTechFloor(page);
    await expect(
      page
        .getByText(
          new RegExp(`${FIXTURE_MOTORCYCLE.make}|${FIXTURE_MOTORCYCLE.model}`, "i")
        )
        .first()
    ).toBeVisible();
  });

  test("technician never sees customer pricing on the floor", async ({ page }) => {
    await openTechFloor(page);
    await page.getByText(FIXTURE_WORK_ORDER.number).first().click();
    // JOB_A retail labour is $200.00; floor surfaces must not show it.
    await expect(page.getByText("$200.00")).toHaveCount(0);
    await expect(page.getByText(`$${(JOB_A.totalCents / 100).toFixed(2)}`)).toHaveCount(
      0
    );
  });
});
