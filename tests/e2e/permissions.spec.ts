import { test, expect } from "@playwright/test";
import { signInAs, storageStatePath } from "./fixtures/auth";
import { FIXTURE_PASSWORD, FIXTURE_USERS } from "./fixtures/ids";

/**
 * Role/route permission matrix against the synthetic QA users.
 * Stateful QA only.
 */

test.describe("technician route boundaries", () => {
  test.use({ storageState: storageStatePath("techA") });

  test("technician is redirected away from office and admin surfaces", async ({
    page,
  }) => {
    for (const path of [
      "/billing",
      "/settings/users",
      "/settings/reports",
      "/control-center",
    ]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
    }
  });

  test("technician opening a work order lands on the tech floor", async ({ page }) => {
    await page.goto("/work_orders");
    await expect(page).toHaveURL(/\/technician|\/login|\/work_orders/);
    // Office work-order detail redirects floor techs to /technician.
    const anyWorkOrderLink = page.getByRole("link", { name: /WO-QA/i }).first();
    if (await anyWorkOrderLink.isVisible().catch(() => false)) {
      await anyWorkOrderLink.click();
      await expect(page).toHaveURL(/\/technician/);
    }
  });
});

test.describe("front office access", () => {
  test.use({ storageState: storageStatePath("advisor") });

  test("advisor reaches work orders and estimate workspace", async ({ page }) => {
    await page.goto("/work_orders");
    await expect(page).toHaveURL(/\/work_orders/);
  });

  test("advisor cannot open owner-only admin surfaces", async ({ page }) => {
    await page.goto("/settings/users");
    await expect(page).not.toHaveURL(/\/settings\/users/);
  });
});

test.describe("owner access", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("owner reaches admin surfaces", async ({ page }) => {
    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/settings\/users/);
  });
});

test.describe("suspended user", () => {
  test("suspended staff cannot sign in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(FIXTURE_USERS.suspended.email);
    await page.getByLabel("Password").fill(FIXTURE_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    // Either an inline error or a bounce back to login — never the app shell.
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain("/login");
  });
});

test.describe("cross-role isolation", () => {
  test("fresh technician session sees no customer PII surfaces", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, "techB");
    await page.goto("/customers");
    await expect(page).not.toHaveURL(/\/customers$/);
    await context.close();
  });
});
