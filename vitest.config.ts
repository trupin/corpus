import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**", "packages/*/src/**", "plugins/*/src/**"],
      exclude: ["**/*.test.ts"],
      // The json reporter emits istanbul-format coverage-final.json; INFRA-004
      // merges e2e coverage into the same gate at that level once Playwright
      // specs exist. Until then the unit-test run carries the 90% bar alone.
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
