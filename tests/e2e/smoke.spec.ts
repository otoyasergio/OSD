import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("smoke", () => {
  test("login page renders and is accessible", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /workshop sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();

    const accessibility = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("unauthenticated dashboard redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("billing and complete are middleware-protected", async ({ page }) => {
    await page.goto("/billing");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/complete");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("webhook security", () => {
  test("Square webhook rejects missing signature", async ({ request }) => {
    const response = await request.post("/api/square/webhooks", {
      data: { type: "invoice.payment_made", event_id: "e2e-test" },
    });
    // 401 invalid signature, or 503 if Square not configured
    expect([401, 503]).toContain(response.status());
  });

  test("Twilio webhook rejects missing signature", async ({ request }) => {
    const response = await request.post("/api/twilio/webhooks", {
      form: { From: "+15551234567", Body: "YES" },
    });
    expect([401, 503]).toContain(response.status());
  });

  test("Wix webhook fails closed without secret or rejects bad auth", async ({
    request,
  }) => {
    const response = await request.post("/api/wix/webhooks/bookings", {
      data: { bookingId: "e2e-booking" },
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect([401, 503]).toContain(response.status());
  });

  test("Wix contacts webhook fails closed without secret or rejects bad auth", async ({
    request,
  }) => {
    const response = await request.post("/api/wix/webhooks/contacts", {
      data: {
        event: "contact.created",
        contact: { id: "e2e-contact", email: "e2e@example.com" },
      },
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect([401, 503]).toContain(response.status());
  });

  test("cron rejects missing bearer", async ({ request }) => {
    const response = await request.get("/api/cron/parts-canada-sync");
    expect([401, 500]).toContain(response.status());
  });

  test("wix contacts cron rejects missing bearer", async ({ request }) => {
    const response = await request.get("/api/cron/wix-contacts-sync");
    expect([401, 500]).toContain(response.status());
  });
});
