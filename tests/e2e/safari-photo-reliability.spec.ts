import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { storageStatePath } from "./fixtures/auth";
import { assertSafeMutationEnvironment } from "./fixtures/environmentGuard";
import { FIXTURE_WORK_ORDER } from "./fixtures/ids";
import {
  assertIntakePhotoObjectsAbsent,
  assertIntakePhotoRemoved,
  findIntakePhotosByNote,
  objectPathsForPhoto,
  removeIntakePhotoArtifacts,
} from "./fixtures/safariPhotoIsolation";
import { createServiceRoleClient } from "./fixtures/seedSyntheticShop";

/**
 * Stateful WebKit photo reliability. Uses Playwright setInputFiles — that is
 * not claimed to reproduce iOS Photos picker bugs. Real-device acceptance
 * covers camera/library pickers. Requires E2E_ALLOW_MUTATION=1 against an
 * isolated TEST_SUPABASE and PHOTO_UPLOAD_QUEUE_ENABLED=1 so close/reopen
 * can resume the durable queue.
 */

test.use({ storageState: storageStatePath("owner") });

const HEIC_FIXTURE = join(process.cwd(), "tests/fixtures/photos/sample.heic");

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("offline HEIC enqueue survives tab close and resumes after reconnect", async ({
  page,
  context,
}, testInfo) => {
  assertSafeMutationEnvironment();
  const admin = createServiceRoleClient();
  const note = `safari-photo-${testInfo.project.name}-${Date.now()}`;
  const capturedObjectPaths: string[] = [];

  try {
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

    const card = resumed.locator("li").filter({ hasText: note });
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: /View Other photo full size/i }).click();
    const dialog = resumed.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await resumed.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    const captured = await findIntakePhotosByNote(admin, FIXTURE_WORK_ORDER.id, note);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.storage_path).toBeTruthy();
    expect(captured[0]).toHaveProperty("thumb_storage_path");
    capturedObjectPaths.push(...captured.flatMap(objectPathsForPhoto));

    await card.getByRole("button", { name: /Remove Other photo/i }).click();
    await card.locator('textarea[name="reason"]').fill("Safari reliability cleanup");
    await card.getByRole("button", { name: /Permanently remove photo/i }).click();
    await expect(resumed.getByText(note)).toHaveCount(0, { timeout: 30_000 });
    await expect(resumed.locator(".photo-queue-status")).toHaveCount(0);
    await expect(resumed.getByText(/waiting for connection/i)).toHaveCount(0);

    await assertIntakePhotoRemoved(admin, captured[0]!);
  } finally {
    try {
      await context.setOffline(false);
      for (const openPage of context.pages()) {
        if (!openPage.isClosed()) {
          await openPage.close();
        }
      }
    } catch {
      // Playwright already closed the context after a test timeout.
    }
    const leftovers = await findIntakePhotosByNote(admin, FIXTURE_WORK_ORDER.id, note);
    capturedObjectPaths.push(...leftovers.flatMap(objectPathsForPhoto));
    await removeIntakePhotoArtifacts(admin, leftovers); // intake-photos original + thumb
    const remaining = await findIntakePhotosByNote(admin, FIXTURE_WORK_ORDER.id, note);
    expect(remaining).toHaveLength(0);
    await assertIntakePhotoObjectsAbsent(admin, capturedObjectPaths);
  }
});
