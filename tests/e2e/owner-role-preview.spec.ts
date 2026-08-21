import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import { FIXTURE_USERS } from "./fixtures/ids";

/**
 * Owner "view as" preview: switch between Owner / Service Advisor / Admin /
 * Tech, mirror a selected technician, and keep every action attributed to
 * the signed-in owner. Stateful QA only.
 */

const ROLE_SELECT_LABEL = "View the app as another role";
const TECH_SELECT_LABEL = "Technician to view as";

/** The switcher lives in the sidebar — on phones that is the drawer. */
async function openNavIfMobile(page: Page): Promise<void> {
  const menuButton = page.getByRole("button", { name: "Open menu" });
  if (await menuButton.isVisible().catch(() => false)) {
    await menuButton.click();
  }
}

async function selectPreviewRole(page: Page, role: string): Promise<void> {
  await openNavIfMobile(page);
  await page.getByLabel(ROLE_SELECT_LABEL).selectOption(role);
}

async function exitPreviewIfActive(page: Page): Promise<void> {
  const exit = page.getByRole("button", { name: "Exit preview" });
  if (await exit.isVisible().catch(() => false)) {
    await exit.click();
    await expect(page.getByRole("button", { name: "Exit preview" })).toHaveCount(0, {
      timeout: 15_000,
    });
  }
}

test.describe("owner role preview", () => {
  test.use({ storageState: storageStatePath("owner") });

  test.afterEach(async ({ page }) => {
    // Never leak preview state into later tests of this serialized suite.
    await exitPreviewIfActive(page).catch(() => {});
  });

  test("service advisor preview reshapes nav, blocks owner surfaces, and resets", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await selectPreviewRole(page, "service_advisor");

    await expect(page.getByText("Viewing as Service Advisor.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Actions are logged as .*\(Owner\)/i)).toBeVisible();

    // Owner-only admin nav disappears while billing stays.
    await openNavIfMobile(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Billing" })).toBeVisible();

    // Direct navigation to an owner-only surface bounces.
    await page.goto("/settings/users");
    await expect(page).not.toHaveURL(/\/settings\/users/);

    // The preview persists across navigation (HTTP-only cookie state).
    await page.goto("/dashboard");
    await expect(page.getByText("Viewing as Service Advisor.")).toBeVisible();

    // One-tap reset restores owner access.
    await exitPreviewIfActive(page);
    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/settings\/users/);
  });

  test("admin preview hides billing and keeps interactive office surfaces", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await selectPreviewRole(page, "admin");

    await expect(page.getByText("Viewing as Admin.")).toBeVisible({ timeout: 15_000 });

    await openNavIfMobile(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Billing" })).toHaveCount(0);

    await page.goto("/billing");
    await expect(page).not.toHaveURL(/\/billing/);

    // Admin still reaches work orders — a representative interactive surface
    // that keeps executing as the signed-in owner.
    await page.goto("/work_orders");
    await expect(page).toHaveURL(/\/work_orders/);
  });

  test("tech preview mirrors a technician docket with identity actions locked", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // Selecting Tech applies the first eligible technician automatically.
    await selectPreviewRole(page, "technician");

    await expect(page.getByText("Viewing as Tech —")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/technician/);
    await expect(
      page.getByText("Owner preview — the technician's bench", { exact: false })
    ).toBeVisible();

    // Office surfaces now redirect like a real technician session.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/technician/);
    await page.goto("/billing");
    await expect(page).not.toHaveURL(/\/billing/);

    // Mirroring the other technician swaps the subject.
    await openNavIfMobile(page);
    await page.getByLabel(TECH_SELECT_LABEL).selectOption(FIXTURE_USERS.techB.id);
    await expect(
      page.getByText(
        `Viewing as Tech — ${FIXTURE_USERS.techB.firstName} ${FIXTURE_USERS.techB.lastName}`
      )
    ).toBeVisible({ timeout: 15_000 });
  });

  test("identity stays the owner while previewing", async ({ page }) => {
    await page.goto("/dashboard");
    await selectPreviewRole(page, "service_advisor");

    // The banner names the signed-in owner as the attributed actor.
    await expect(
      page.getByText(
        `Actions are logged as ${FIXTURE_USERS.owner.firstName} ${FIXTURE_USERS.owner.lastName} (Owner).`
      )
    ).toBeVisible({ timeout: 15_000 });
  });

  test("switcher is keyboard operable", async ({ page }) => {
    await page.goto("/dashboard");
    await openNavIfMobile(page);
    const roleSelect = page.getByLabel(ROLE_SELECT_LABEL);
    await roleSelect.focus();
    await expect(roleSelect).toBeFocused();
    await roleSelect.selectOption("admin");
    await expect(
      page.getByRole("status").filter({ hasText: "Viewing as Admin." })
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("owner role preview on a phone viewport", () => {
  test.use({
    storageState: storageStatePath("owner"),
    viewport: { width: 390, height: 844 },
  });

  test("switcher works from the mobile drawer", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByLabel(ROLE_SELECT_LABEL).selectOption("service_advisor");
    await expect(page.getByText("Viewing as Service Advisor.")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Exit preview" }).click();
    await expect(page.getByText("Viewing as Service Advisor.")).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});

test.describe("preview cookies are owner-only", () => {
  test.use({ storageState: storageStatePath("techA") });

  test("forged preview cookies do nothing for a technician session", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      {
        name: "otomoto_role_preview_role",
        value: "admin",
        url: baseURL ?? "http://127.0.0.1:3000",
      },
    ]);

    // Admin can reach /customers; a technician must still be bounced.
    await page.goto("/customers");
    await expect(page).not.toHaveURL(/\/customers$/);

    // And no switcher is offered to non-owners.
    await page.goto("/technician");
    await openNavIfMobile(page);
    await expect(page.getByLabel(ROLE_SELECT_LABEL)).toHaveCount(0);
  });
});
