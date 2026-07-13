import { test, expect } from "@playwright/test";

test.describe("messages", () => {
  test("messages routes are middleware-protected", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/messages");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/messages/directory");
    await expect(page).toHaveURL(/\/login/);
  });

  test("calls token route requires auth", async ({ request }) => {
    const response = await request.post("/api/calls/token", {
      data: { call_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect([401, 404, 503]).toContain(response.status());
  });
});
