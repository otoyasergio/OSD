import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/evals/diagnostics/**/*.eval.ts"],
    setupFiles: ["tests/evals/diagnostics/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
