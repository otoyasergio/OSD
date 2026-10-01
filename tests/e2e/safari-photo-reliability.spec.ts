import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { storageStatePath } from "./fixtures/auth";
import { FIXTURE_WORK_ORDER } from "./fixtures/ids";

/**
 * Stateful WebKit photo reliability. Uses Playwright setInputFiles — that is
 * not claimed to reproduce iOS Photos picker bugs. Real-device acceptance
 * covers camera/library pickers. Requires E2E_ALLOW_MUTATION=1 against an
 * isolated TEST_SUPABASE and PHOTO_UPLOAD_QUEUE_ENABLED=1 so close/reopen
 * can resume the durable queue.
 */

test.use({ storageState: storageStatePath("owner") });

const HEIC_FIXTURE = join(process.cwd(), "tests/fixtures/photos/sample.heic");

test.describe.configure({ mode: "serial" });

test("offline HEIC enqueue survives tab close and resumes after reconnect", async ({
  page,
  context,
}, testInfo) => {
  const note = `safari-photo-${testInfo.project.name}-${Date.now()}`;

  await page.goto(`/work_orders/${FIXTURE_WORK_ORDER.id}?tab=photos`);
  await expect(page.getByText("Upload intake photo")).toBeVisible();

  await page.locator('select[name="category"]').selectOption("other");
  await page.locator('input[name="notes"]').fill(note);

  await context.setOffline(true);
  const library = page.getByLabel("Photo library");
  await library.setInputFiles(HEIC_FIXTURE);

  await expect(page.getByText(/waiting for connection/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(note)).toHaveCount(0);

  await page.close();
  await context.setOffline(false);

  const resumed = await context.newPage();
  await resumed.goto(`/work_orders/${FIXTURE_WORK_ORDER.id}?tab=photos`);
  await expect(resumed.getByText(note, { exact: true })).toBeVisible({
    timeout: 90_000,
  });

  await resumed
    .getByRole("button", { name: /View Other photo full size/i })
    .first()
    .click();
  const dialog = resumed.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await resumed.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const card = resumed.locator("li").filter({ hasText: note }).first();
  await card.getByRole("button", { name: /Remove Other photo/i }).click();
  await card.locator('textarea[name="reason"]').fill("Safari reliability cleanup");
  await card.getByRole("button", { name: /Permanently remove photo/i }).click();
  await expect(resumed.getByText(note)).toHaveCount(0, { timeout: 30_000 });
  await expect(resumed.locator(".photo-queue-status")).toHaveCount(0);
  await expect(resumed.getByText(/waiting for connection/i)).toHaveCount(0);
});
