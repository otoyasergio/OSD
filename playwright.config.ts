import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const allowMutation = process.env.E2E_ALLOW_MUTATION === "1";

/**
 * Specs that sign in and mutate the synthetic QA dataset. They only run when
 * E2E_ALLOW_MUTATION=1 (global setup seeds the data and verifies the target
 * is an isolated database). Files may not exist yet; zero matches is fine.
 */
const STATEFUL_SPECS = [
  "**/technician-workflow.spec.ts",
  "**/jobs-estimate.spec.ts",
  "**/portal-estimate.spec.ts",
  "**/permissions.spec.ts",
  "**/owner-role-preview.spec.ts",
  "**/realtime-races.spec.ts",
  "**/photo-contract-regression.spec.ts",
  "**/accessibility.spec.ts",
  "**/keyboard.spec.ts",
  "**/responsive.spec.ts",
];

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Stateful runs share one seeded dataset; serialize to keep them honest.
  workers: allowMutation ? 1 : undefined,
  globalSetup: "./tests/e2e/global.setup.ts",
  globalTeardown: "./tests/e2e/global.teardown.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: STATEFUL_SPECS,
    },
    ...(allowMutation
      ? [
          {
            name: "webkit-desktop",
            use: { ...devices["Desktop Safari"] },
            testMatch: STATEFUL_SPECS,
          },
          {
            name: "webkit-ipad-landscape",
            use: { ...devices["iPad Pro 11 landscape"] },
            testMatch: STATEFUL_SPECS,
          },
          {
            name: "webkit-ipad-portrait",
            use: { ...devices["iPad Pro 11"] },
            testMatch: STATEFUL_SPECS,
          },
          {
            name: "mobile-phone",
            use: { ...devices["iPhone 13 Mini"] },
            testMatch: STATEFUL_SPECS,
          },
        ]
      : []),
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "npm run start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
