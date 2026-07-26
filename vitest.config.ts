import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `.tsx` is included for `apps/ui`, whose components are tested with React
    // Testing Library. Those files opt into jsdom with a per-file
    // `@vitest-environment` docblock; everything else stays on Node.
    include: [
      "apps/**/src/**/*.test.{ts,tsx}",
      "packages/**/src/**/*.test.{ts,tsx}",
      "plugins/**/src/**/*.test.{ts,tsx}",
      // Repo tooling lives outside the workspaces (CLAUDE.md → Repository
      // Structure) but is still tested by `npm test`.
      "scripts/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**", "packages/*/src/**", "plugins/*/src/**"],
      // Bin shims are thin process glue (argv in, stdout out) with no logic of
      // their own — the logic they delegate to is covered directly. Generated
      // `*.generated.ts` modules are type-only declarations with no runtime
      // statements to cover; their generator is tested instead.
      exclude: ["**/*.test.{ts,tsx}", "apps/*/src/bin/**", "**/*.generated.ts"],
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
