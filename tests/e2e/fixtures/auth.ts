import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { FIXTURE_PASSWORD, FIXTURE_USERS, type FixtureRole } from "./ids";

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
