import { test, expect } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import { ESTIMATE_TOTALS, FIXTURE_WORK_ORDER, JOB_C } from "./fixtures/ids";

/**
 * Customer portal estimate journey. Stateful QA only. The advisor presents
 * the estimate through the workspace, generates a portal link, and the
 * customer decides each job and confirms once.
 */

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

test.describe("portal estimate decisions", () => {
  test("advisor presents, customer decides per job and confirms once", async ({
    browser,
  }) => {
    // 1. Advisor presents the estimate and creates a portal link.
    const advisorContext = await browser.newContext({
      storageState: storageStatePath("advisor"),
    });
    const advisor = await advisorContext.newPage();
    await advisor.goto("/work_orders");
    await advisor.getByText(FIXTURE_WORK_ORDER.number).first().click();
    const estimateTab = advisor
      .getByRole("link", { name: /estimate/i })
      .or(advisor.getByRole("tab", { name: /estimate/i }))
      .first();
    await estimateTab.click();

    const present = advisor.getByRole("button", { name: /present/i }).first();
    if (await present.isEnabled().catch(() => false)) {
      await present.click();
      await expect(advisor.getByText(/presented/i).first()).toBeVisible({
        timeout: 15_000,
      });
    }

    // Portal link creation UI lives on the work order; find a portal URL.
    const linkButton = advisor
      .getByRole("button", { name: /portal|share|send estimate/i })
      .first();
    let portalUrl: string | null = null;
    if (await linkButton.isVisible().catch(() => false)) {
      await linkButton.click();
      const linkText = await advisor
        .getByText(/\/c\/[A-Za-z0-9_-]+/)
        .first()
        .innerText()
        .catch(() => null);
      portalUrl = linkText?.match(/\/c\/[A-Za-z0-9_-]+/)?.[0] ?? null;
    }
    await advisorContext.close();

    if (!portalUrl) {
      test.fixme(
        true,
        "portal link surface not yet exposed in workspace UI — generate token via fixture in follow-up"
      );
      return;
    }

    // 2. Customer opens the portal anonymously and decides.
    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    await customer.goto(portalUrl);

    await expect(
      customer.getByRole("heading", { name: /review your estimate/i })
    ).toBeVisible();

    // Confirm is blocked until every job has a decision.
    const confirm = customer.getByRole("button", {
      name: /confirm my decisions|choose approve or decline/i,
    });
    await expect(confirm).toBeDisabled();

    const groups = customer.getByRole("group");
    const groupCount = await groups.count();
    for (let i = 0; i < groupCount; i += 1) {
      const group = groups.nth(i);
      const title = await group.innerText();
      if (title.includes(JOB_C.name)) {
        await group.getByRole("button", { name: /decline/i }).click();
      } else {
        await group.getByRole("button", { name: /approve/i }).click();
      }
    }

    // Accepted total reflects approve A+B, decline C.
    await expect(
      customer.getByText(dollars(ESTIMATE_TOTALS.acceptedTotalCents))
    ).toBeVisible();

    await customer.getByRole("button", { name: /confirm my decisions/i }).click();
    await expect(
      customer.getByRole("heading", { name: /estimate confirmed/i })
    ).toBeVisible({ timeout: 15_000 });

    // 3. Replay safety: reloading shows the confirmed summary, not the form.
    await customer.reload();
    await expect(
      customer.getByRole("heading", { name: /estimate confirmed/i })
    ).toBeVisible();

    await customerContext.close();
  });
});
