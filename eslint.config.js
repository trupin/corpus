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
  // Type-aware rules need a tsconfig project; JS config files have none.
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
);
