import { expect, test, type Page } from "@playwright/test";
import { storageStatePath } from "./fixtures/auth";
import {
  ASSISTANT_FIXTURES,
  FIXTURE_USERS,
  FIXTURE_WORK_ORDER,
  ISOLATION_WORK_ORDER,
  JOB_A,
} from "./fixtures/ids";

function officeAssistantUrl(threadId: string): string {
  return `/work_orders/${FIXTURE_WORK_ORDER.id}?tab=assistant&thread=${threadId}`;
}

function floorAssistantUrl(threadId: string): string {
  const params = new URLSearchParams({
    wo: FIXTURE_WORK_ORDER.id,
    job: JOB_A.id,
    panel: "packet",
    packetSection: "assistant",
    assistantThread: threadId,
  });
  return `/technician?${params.toString()}`;
}

function observeProviderRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/openai\.com/i.test(request.url())) requests.push(request.url());
  });
  return requests;
}

test.describe("Ask OTOMOTO advisor verification", () => {
  test.use({ storageState: storageStatePath("advisor") });

  test("advisor draft is copy-only and missing configuration preserves history", async ({
    page,
  }) => {
    const providerRequests = observeProviderRequests(page);
    await page.goto(officeAssistantUrl(ASSISTANT_FIXTURES.advisor.threadId));

    await expect(page.getByRole("heading", { name: "Ask OTOMOTO" })).toBeVisible();
    await expect(page.getByText(/The cause has not been verified/)).toBeVisible();
    await expect(
      page.getByText(/Copy only\. Nothing is sent to the customer from here/)
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy AI draft" })).toBeVisible();
    await expect(
      page.getByText(
        /not configured on this server.*Existing conversations stay readable/i
      )
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Review and save as note" })
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Send to customer/i })).toHaveCount(0);
    await expect(page.getByLabel("Message to Ask OTOMOTO")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Send to Ask OTOMOTO" })
    ).toBeDisabled();
    expect(providerRequests).toEqual([]);
  });

  test("selected thread cannot cross its work-order boundary", async ({ page }) => {
    await page.goto(officeAssistantUrl(ASSISTANT_FIXTURES.isolated.threadId));

    await expect(page.getByText(/selected conversation is unavailable/i)).toBeVisible();
    await expect(page.getByText(/belongs only to WO-QA-0002/i)).toHaveCount(0);
    await expect(page.getByText(ISOLATION_WORK_ORDER.number)).toHaveCount(0);
  });
});

test.describe("Ask OTOMOTO assigned-technician verification", () => {
  test.use({ storageState: storageStatePath("techA") });

  test("assigned technician sees the technical packet but no advisor thread", async ({
    page,
  }) => {
    const providerRequests = observeProviderRequests(page);
    await page.goto(floorAssistantUrl(ASSISTANT_FIXTURES.technical.threadId));

    await expect(page.getByRole("tabpanel")).toContainText(
      "The no-crank symptom is reported"
    );
    await expect(page.getByRole("link", { name: /Technician \(\/shop\)/ })).toBeVisible();
    await expect(page.getByText(/The cause has not been verified/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Service Advisor/ })).toHaveCount(0);
    expect(providerRequests).toEqual([]);
  });

  test("technician cannot open a front-office or another-work-order thread", async ({
    page,
  }) => {
    await page.goto(floorAssistantUrl(ASSISTANT_FIXTURES.advisor.threadId));
    await expect(page.getByText(/selected conversation is unavailable/i)).toBeVisible();
    await expect(page.getByText(/The cause has not been verified/)).toHaveCount(0);

    await page.goto(floorAssistantUrl(ASSISTANT_FIXTURES.isolated.threadId));
    await expect(page.getByText(/selected conversation is unavailable/i)).toBeVisible();
    await expect(page.getByText(/belongs only to WO-QA-0002/i)).toHaveCount(0);
  });

  test("office deep link routes a floor technician into the packet", async ({ page }) => {
    await page.goto(officeAssistantUrl(ASSISTANT_FIXTURES.technical.threadId));

    await expect(page).toHaveURL(/\/technician\?/);
    await expect(page).toHaveURL(/packetSection=assistant/);
    await expect(page).toHaveURL(
      new RegExp(`assistantThread=${ASSISTANT_FIXTURES.technical.threadId}`)
    );
    await expect(page.getByRole("tabpanel")).toContainText(
      "The no-crank symptom is reported"
    );
  });
});

test.describe("Ask OTOMOTO role preview", () => {
  test.use({ storageState: storageStatePath("owner") });

  test.afterEach(async ({ page }) => {
    const exit = page.getByRole("button", { name: "Exit preview" });
    if (await exit.isVisible().catch(() => false)) await exit.click();
  });

  test("owner previewing an advisor gets a read-only assistant surface", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const menu = page.getByRole("button", { name: "Open menu" });
    if (await menu.isVisible().catch(() => false)) await menu.click();
    await page.getByLabel("View the app as another role").selectOption("service_advisor");
    await expect(page.getByText("Viewing as Service Advisor.")).toBeVisible({
      timeout: 15_000,
    });

    await page.goto(officeAssistantUrl(ASSISTANT_FIXTURES.advisor.threadId));
    await expect(
      page.getByText(
        `Actions are logged as ${FIXTURE_USERS.owner.firstName} ${FIXTURE_USERS.owner.lastName} (Owner).`
      )
    ).toBeVisible();
    await expect(page.getByText(/Role preview is read-only/)).toBeVisible();
    await expect(page.getByLabel("Message to Ask OTOMOTO")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Send to Ask OTOMOTO" })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Review and save as note" })
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy AI draft" })).toBeVisible();
  });
});
