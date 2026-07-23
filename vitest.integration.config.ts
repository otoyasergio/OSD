import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Integration tests hit a real (isolated) Supabase stack. They skip cleanly
 * when TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY are not set — see
 * tests/integration/helpers.ts.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
