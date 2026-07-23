import { test, expect } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import { createServiceRoleClient } from "./fixtures/seedSyntheticShop";
import { generatePortalToken } from "../../lib/portal/tokens";
import { FIXTURE_USERS, FIXTURE_WORK_ORDER, JOB_A, JOB_B, JOB_C } from "./fixtures/ids";

/**
 * Customer portal estimate journey (stateful QA runs only):
 * the advisor presents the estimate through the workspace UI, a portal
 * token is minted with the service-role fixture client (no staff UI issues
 * portal links yet), and the customer decides every job then confirms once.
 *
 * Requires JOBS_ESTIMATE_V2_WRITE_MODE=dual|v2 on the app under test; the
 * journey skips cleanly when the workspace is disabled.
 *
 * NOTE: estimate versions/decisions/confirmations are append-only evidence
 * (database triggers). Teardown's row deletes cannot remove them — reset the
 * isolated QA database (`supabase db reset`) to fully clean up after runs.
 */

test.use({ storageState: storageStatePath("advisor") });

function parseConfirmTotal(text: string): number {
  const match = text.match(/\$([\d,]+\.\d{2})/);
  if (!match) throw new Error(`no dollar amount in: ${text}`);
  return Number(match[1].replace(/,/g, ""));
}

test.describe("portal estimate decisions", () => {
  test("advisor presents, customer decides every job and confirms once", async ({
    page,
    browser,
    baseURL,
  }) => {
    const supabase = createServiceRoleClient();

    // Every fixture job must still need authorization so presenting freezes
    // all three onto the version (the seed pre-approves JOB_A/JOB_B for the
    // legacy specs; confirming below dual-writes them back to approved).
    const { error: statusError } = await supabase
      .from("job")
      .update({
        status: "waiting_for_approval",
        approved_by_customer_at: null,
        approval_method: null,
        approval_recorded_by_user_id: null,
        declined_at: null,
        decline_reason: null,
      })
      .in("job_id", [JOB_A.id, JOB_B.id, JOB_C.id]);
    expect(statusError).toBeNull();

    // 1. Advisor presents the estimate through the workspace UI.
    await page.goto(`/work_orders/${FIXTURE_WORK_ORDER.id}?tab=estimate`);
    const present = page.getByRole("button", { name: /^present/i }).first();
    const workspaceEnabled = await present
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(
      !workspaceEnabled,
      "Estimate workspace disabled — set JOBS_ESTIMATE_V2_WRITE_MODE=dual to run"
    );

    await expect(present).toBeEnabled();
    await present.click();
    await expect(
      page.getByRole("region", { name: "Record customer decisions" })
    ).toBeVisible({ timeout: 15_000 });

    // 2. Mint an estimate-purpose portal token scoped to the fixture WO.
    const { token, hash } = generatePortalToken();
    const { error: tokenError } = await supabase.from("customer_portal_token").insert({
      work_order_id: FIXTURE_WORK_ORDER.id,
      token_hash: hash,
      purpose: "estimate",
      expires_at: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
      created_by_user_id: FIXTURE_USERS.advisor.id,
    });
    expect(tokenError).toBeNull();

    // 3. Customer decides in an unauthenticated context.
    const customerContext = await browser.newContext({ baseURL });
    try {
      const customer = await customerContext.newPage();
      await customer.goto(`/c/${token}`);

      await expect(
        customer.getByRole("heading", { name: /review your estimate/i })
      ).toBeVisible();
      // The V2 card replaces the legacy per-job approve buttons.
      await expect(
        customer.getByRole("heading", { name: /approve recommended work/i })
      ).toHaveCount(0);

      for (const job of [JOB_A, JOB_B, JOB_C]) {
        await expect(customer.getByRole("group", { name: job.name })).toBeVisible();
      }

      // Confirm stays blocked until every job is decided and a name is given.
      const confirm = customer.getByRole("button", {
        name: /confirm my decisions|choose approve or decline/i,
      });
      await expect(confirm).toBeDisabled();

      // Read each frozen per-job total from its card (the last <dd> row).
      const jobTotal = async (jobName: string) =>
        parseConfirmTotal(
          await customer
            .getByRole("group", { name: jobName })
            .locator("dd")
            .last()
            .innerText()
        );
      const totalA = await jobTotal(JOB_A.name);
      const totalB = await jobTotal(JOB_B.name);

      const decide = (jobName: string, decision: "Approve" | "Decline") =>
        customer
          .getByRole("group", { name: jobName })
          .getByRole("button", { name: decision, exact: true })
          .click();

      await decide(JOB_A.name, "Approve");
      await decide(JOB_B.name, "Approve");
      await expect(confirm).toBeDisabled(); // JOB_C still undecided

      await decide(JOB_C.name, "Decline");
      // Accepted total recomputes client-side: approved A + B only.
      await expect(customer.getByText(/total if confirmed/i)).toHaveText(
        new RegExp(`\\$${(totalA + totalB).toFixed(2).replace(".", "\\.")}`)
      );

      // Name is required before confirming.
      const nameInput = customer.getByLabel("Full name");
      await nameInput.fill("");
      await expect(confirm).toBeDisabled();
      await nameInput.fill("Quinn Appleseed");
      await expect(confirm).toBeEnabled();
      await confirm.click();

      await expect(
        customer.getByRole("heading", { name: /estimate confirmed/i })
      ).toBeVisible({ timeout: 15_000 });
      await expect(customer.getByText(/approved ·/i)).toHaveCount(2);
      await expect(customer.getByText("Declined", { exact: true })).toHaveCount(1);

      // 4. Replay safety: reloading shows the summary, never the form again.
      await customer.reload();
      await expect(
        customer.getByRole("heading", { name: /estimate confirmed/i })
      ).toBeVisible();
      await expect(
        customer.getByRole("button", { name: /confirm my decisions/i })
      ).toHaveCount(0);
    } finally {
      await customerContext.close();
      await supabase.from("customer_portal_token").delete().eq("token_hash", hash);
    }
  });
});
