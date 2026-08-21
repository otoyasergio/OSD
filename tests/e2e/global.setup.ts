import { chromium } from "@playwright/test";
import { assertSafeMutationEnvironment } from "./fixtures/environmentGuard";
import { seedSyntheticShop } from "./fixtures/seedSyntheticShop";
import { ensureAuthStates } from "./fixtures/auth";

/**
 * No-ops for stateless runs (default `npm run test:e2e`). With
 * E2E_ALLOW_MUTATION=1 it verifies the environment is an isolated QA target,
 * seeds the synthetic shop, and captures per-role auth storage states.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_ALLOW_MUTATION !== "1") {
    console.log(
      "[e2e] E2E_ALLOW_MUTATION is not '1' — running stateless specs only " +
        "(no seeding, no auth states)."
    );
    return;
  }

  assertSafeMutationEnvironment();
  await seedSyntheticShop();

  const browser = await chromium.launch();
  try {
    await ensureAuthStates(browser);
  } finally {
    await browser.close();
  }
}
