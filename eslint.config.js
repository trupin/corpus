// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// Lint philosophy (see docs/TS_GUIDELINES.md): only rules with a real risk of
// shipping a bug are errors (blocking). Style and taste belong to the
// guidelines and code review, not the linter — tsc strict mode already covers
// type correctness; eslint adds the correctness checks the compiler can't see.
// Useful-but-not-critical signals are warnings: visible, never blocking.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "dist-package/",
      ".claude/worktrees/",
      "**/build/",
      "**/coverage/",
      "**/coverage-raw/",
      "design/",
      "**/*.generated.ts",
      "packages/contract/openapi.json",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Critical, type-aware async safety: unawaited or mishandled promises
      // fail silently at runtime — the top bug class tsc can't catch.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // Non-critical recommended rules downgraded to warnings.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The `any`-propagation family: these fire wherever a value typed `any`
      // flows onward, so they are the downstream half of `no-explicit-any`.
      // That rule is a deliberate warning, so these match it — a blocking gate
      // here would contradict it and would punish trust-boundary code before
      // its Zod parse narrows the value (see docs/TS_GUIDELINES.md).
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
    },
  },
  // ---- Plugin boundaries (SPEC.md §10, PLUGINS-001) ----------------------
  // The kit-only rule: plugin code imports @corpus/kit and @corpus/contract,
  // nothing else — not `apps/ui/src` internals, not another workspace, not a
  // relative path that walks out of `plugins/`. `@corpus/contract/client` is
  // also off-limits: a plugin that constructs its own transport bypasses the
  // kit's cache and invalidation (see packages/kit/src/index.ts).
  //
  // Hence the asymmetry below: `@corpus/kit/**` is allowed wholesale, while
  // the contract's subpaths are admitted one at a time — `@corpus/contract/plugin`
  // (the types-only plugin surface, CONTRACT-015) and nothing else. A blanket
  // `!@corpus/contract/**` would re-open the `/client` hole this rule exists
  // to close; `scripts/eslint-boundaries.test.ts` proves both directions.
  {
    files: ["plugins/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@corpus/*",
                "@corpus/*/**",
                "!@corpus/kit",
                "!@corpus/kit/**",
                "!@corpus/contract",
                "!@corpus/contract/plugin",
              ],
              message:
                "Plugins may import only @corpus/kit and @corpus/contract (SPEC.md §10 — the kit is the UI contract).",
            },
            {
              group: ["**/apps/**", "**/packages/**"],
              message:
                "Plugins may import only @corpus/kit and @corpus/contract (SPEC.md §10) — never a workspace's internals by path.",
            },
          ],
        },
      ],
    },
  },
  // The core→plugin ban: core never imports plugin code. Discovery is the only
  // coupling, through exactly three entry points (SPEC.md §10), allowlisted by
  // path in the block below.
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // The repo-root `plugins/` tree, reached by walking out of the
              // workspace (any depth) or by a plugin package name. Deliberately
              // NOT `**/plugins/**`, which would also match core-internal
              // directories like `apps/ui/src/plugins/`.
              group: [
                "../../../plugins/**",
                "../../../../plugins/**",
                "../../../../../plugins/**",
                "corpus-plugin-*",
              ],
              message:
                "Core never imports from plugins/ — plugins are discovered, not imported (SPEC.md §10). " +
                "The only entry points are the UI registry, the server discoverer, and the CLI scanner.",
            },
          ],
        },
      ],
    },
  },
  // The three discovery entry points (SPEC.md §10): the UI manifest registry,
  // the server route discoverer, and the CLI command scanner. These are the
  // whole coupling surface between core and plugins/, enumerated by path.
  {
    files: [
      "apps/ui/src/plugins/registry.ts",
      "apps/server/src/plugins/discover.ts",
      "apps/cli/src/registry/plugins.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Type-aware rules need a tsconfig project; JS config files have none.
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
);
