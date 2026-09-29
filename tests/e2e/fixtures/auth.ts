import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import {
  ASSISTANT_FIXTURES,
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  FIXTURE_WORK_ORDER,
  type FixtureRole,
} from "./ids";

/**
 * Login helpers for the synthetic QA users. Storage states are written once
 * per run by global setup so specs can start already authenticated via
 * `test.use({ storageState: storageStatePath("techA") })`.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

/**
 * Roles that can complete the login flow. `suspended` is deliberately
 * excluded: the app blocks inactive staff, so no storage state can exist —
 * specs assert that the login attempt fails instead.
 */
export const AUTH_STATE_ROLES: readonly FixtureRole[] = [
  "advisor",
  "techA",
  "techB",
  "headTech",
  "manager",
  "owner",
];

export function storageStatePath(role: FixtureRole): string {
  return `test-results/.auth/${role}.json`;
}

/** Signs in through the real /login form and waits to land in the app. */
export async function signInAs(page: Page, role: FixtureRole): Promise<void> {
  const user = FIXTURE_USERS[role];
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
}

/** Logs in each signable role once and saves its storage state to disk. */
export async function ensureAuthStates(browser: Browser): Promise<void> {
  await mkdir(path.dirname(storageStatePath("advisor")), { recursive: true });

  for (const role of AUTH_STATE_ROLES) {
    // Global setup does not inherit config `use` options, so pass baseURL.
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    try {
      await signInAs(page, role);
      await context.storageState({ path: storageStatePath(role) });
      console.log(`[auth] saved storage state for ${role}`);
    } catch (error) {
      throw new Error(
        `[auth] failed to sign in as ${role} (${FIXTURE_USERS[role].email}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      await context.close();
    }
  }
}

/**
 * Authenticated server-config preflight. This is required even when Playwright
 * skips its own web server and targets a remote QA host: stateful specs must
 * never run against an app capable of calling the live model.
 */
export async function assertAskOtomotoUnconfigured(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: storageStatePath("advisor"),
  });
  const page = await context.newPage();
  try {
    await page.goto(
      `/work_orders/${FIXTURE_WORK_ORDER.id}?tab=assistant&thread=${ASSISTANT_FIXTURES.advisor.threadId}`
    );
    await page
      .getByRole("status")
      .filter({ hasText: "Ask OTOMOTO is not configured on this server" })
      .waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    throw new Error(
      "[e2e] Ask OTOMOTO provider preflight failed. Stateful E2E requires an " +
        "authenticated local/disposable-QA server with OPENAI_API_KEY unset; " +
        "the server did not report 'not configured'. No specs were started.",
      { cause: error }
    );
  } finally {
    await context.close();
  }
}
