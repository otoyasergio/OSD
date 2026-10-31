import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import { createServiceRoleClient } from "./fixtures/seedSyntheticShop";
import {
  FIXTURE_CUSTOMER,
  FIXTURE_MOTORCYCLE,
  FIXTURE_USERS,
  FIXTURE_WORK_ORDER,
  JOB_A,
  JOB_B,
  JOB_C,
} from "./fixtures/ids";

test.use({ storageState: storageStatePath("advisor") });

test.describe("privacy-safe vehicle passport", () => {
  test("publishes a frozen service-only view, shares it, then revokes it", async ({
    page,
    browser,
    baseURL,
  }) => {
    const supabase = createServiceRoleClient();
    const communicationId = randomUUID();
    const paymentId = randomUUID();
    const privateMessage = `PRIVATE-PASSPORT-MESSAGE-${communicationId}`;
    const privatePayment = `sq-passport-${paymentId}`;
    const completedAt = new Date(Date.now() - 86_400_000).toISOString();
    const originalWorkOrder = await supabase
      .from("work_order")
      .select("status, completed_at")
      .eq("work_order_id", FIXTURE_WORK_ORDER.id)
      .single();
    const originalJobs = await supabase
      .from("job")
      .select("job_id, status, completed_at")
      .in("job_id", [JOB_A.id, JOB_B.id, JOB_C.id]);
    expect(originalWorkOrder.error).toBeNull();
    expect(originalJobs.error).toBeNull();

    try {
      expect(
        (
          await supabase
            .from("work_order")
            .update({
              status: "completed",
              completed_at: completedAt,
              mileage: FIXTURE_WORK_ORDER.mileage,
              mileage_unit: "km",
            })
            .eq("work_order_id", FIXTURE_WORK_ORDER.id)
        ).error
      ).toBeNull();
      expect(
        (
          await supabase
            .from("job")
            .update({ status: "completed", completed_at: completedAt })
            .eq("job_id", JOB_A.id)
        ).error
      ).toBeNull();
      expect(
        (
          await supabase
            .from("job")
            .update({ status: "declined", completed_at: null })
            .in("job_id", [JOB_B.id, JOB_C.id])
        ).error
      ).toBeNull();
      expect(
        (
          await supabase.from("communication_log").insert({
            log_id: communicationId,
            work_order_id: FIXTURE_WORK_ORDER.id,
            customer_id: FIXTURE_CUSTOMER.id,
            channel: "sms",
            direction: "outbound",
            to_address: FIXTURE_CUSTOMER.phone,
            body: privateMessage,
            status: "sent",
            sent_by_user_id: FIXTURE_USERS.advisor.id,
          })
        ).error
      ).toBeNull();
      expect(
        (
          await supabase.from("payment").insert({
            payment_id: paymentId,
            work_order_id: FIXTURE_WORK_ORDER.id,
            provider: "square",
            provider_transaction_id: privatePayment,
            amount_cents: 98_765,
            status: "succeeded",
          })
        ).error
      ).toBeNull();

      await page.goto(`/motorcycles/${FIXTURE_MOTORCYCLE.id}/passport`);
      await expect(
        page.getByRole("heading", { name: "Vehicle passport", exact: true })
      ).toBeVisible();
      await expect(page.getByText(JOB_A.name, { exact: true })).toBeVisible();
      await expect(page.getByText(FIXTURE_CUSTOMER.email)).toHaveCount(0);
      await expect(page.getByText(FIXTURE_CUSTOMER.phone)).toHaveCount(0);
      await expect(page.getByText(privateMessage)).toHaveCount(0);
      await expect(page.getByText(privatePayment)).toHaveCount(0);

      await page.getByRole("button", { name: /^Publish version \d+$/ }).click();
      await expect(page.getByText(/version \d+ published/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByRole("heading", { name: "Current published version" })
      ).toBeVisible();

      await page.getByRole("button", { name: "Create seven-day link" }).click();
      const shareInput = page.getByLabel("Copy this link now");
      await expect(shareInput).toBeVisible();
      const shareUrl = await shareInput.inputValue();
      expect(shareUrl).toContain("/p/");

      const publicContext = await browser.newContext({ baseURL });
      try {
        const publicPage = await publicContext.newPage();
        await publicPage.goto(new URL(shareUrl).pathname);
        await expect(
          publicPage.getByRole("heading", {
            name: "Vehicle service passport",
            exact: true,
          })
        ).toBeVisible();
        await expect(publicPage.getByText(JOB_A.name, { exact: true })).toBeVisible();
        const publicBody = await publicPage.locator("body").innerText();
        for (const forbidden of [
          FIXTURE_CUSTOMER.firstName,
          FIXTURE_CUSTOMER.lastName,
          FIXTURE_CUSTOMER.email,
          FIXTURE_CUSTOMER.phone,
          privateMessage,
          privatePayment,
          "98765",
        ]) {
          expect(publicBody).not.toContain(forbidden);
        }
        await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute(
          "content",
          /noindex/i
        );

        await page.getByRole("button", { name: "Revoke link" }).click();
        await expect(page.getByText("Passport link revoked.")).toBeVisible();
        await publicPage.reload();
        await expect(
          publicPage.getByRole("heading", {
            name: "Passport link unavailable",
          })
        ).toBeVisible();
      } finally {
        await publicContext.close();
      }
    } finally {
      await supabase.from("communication_log").delete().eq("log_id", communicationId);
      await supabase.from("payment").delete().eq("payment_id", paymentId);
      if (originalWorkOrder.data) {
        await supabase
          .from("work_order")
          .update(originalWorkOrder.data)
          .eq("work_order_id", FIXTURE_WORK_ORDER.id);
      }
      for (const job of originalJobs.data ?? []) {
        await supabase
          .from("job")
          .update({ status: job.status, completed_at: job.completed_at })
          .eq("job_id", job.job_id);
      }
    }
  });
});
