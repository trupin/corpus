import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**", "packages/*/src/**"],
      exclude: ["**/*.test.ts"],
      // Raw V8 output (json) is kept so e2e coverage can be merged into the
      // same gate once Playwright specs exist (INFRA-004); until then the
      // unit-test run carries the combined 90% bar on its own.
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
