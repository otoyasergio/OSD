import { test, expect } from "@playwright/test";

/**
 * Read-only production smoke. Safe against any target (including
 * https://service.torontomoto.com with PLAYWRIGHT_SKIP_WEBSERVER=1): it
 * performs zero authenticated actions and zero mutations beyond
 * unsigned-webhook rejection probes that must fail closed.
 */

test.describe("production read-only smoke", () => {
  test("mutation fixtures must never target this suite", () => {
    expect(process.env.E2E_ALLOW_MUTATION ?? "0").not.toBe("1");
  });

  test("login page renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /workshop sign in/i })).toBeVisible();
  });

  test("staff surfaces require authentication", async ({ page }) => {
    for (const path of [
      "/technician",
      "/control-center",
      "/billing",
      "/work_orders",
      "/settings/users",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("unsigned Square webhook is rejected", async ({ request }) => {
    const response = await request.post("/api/square/webhooks", {
      data: { type: "invoice.payment_made", event_id: "prod-readonly-probe" },
    });
    expect([401, 503]).toContain(response.status());
  });

  test("portal token route fails closed for a bogus token", async ({ page }) => {
    const response = await page.goto("/c/not-a-real-token");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByText(/expired|invalid|not found/i)).toBeVisible();
  });
});
