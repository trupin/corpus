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
  // ---- The kit owns the transport (INFRA-031) ----------------------------
  // INFRA-031 deleted `plugins/`, and with it the two rules that policed the
  // core↔plugin boundary. Both were vacuous the moment there was no plugin to
  // ban. One clause of the kit-only rule survives its cause, and it is kept
  // here: **a consumer never builds its own client.** The reason was always the
  // cache, never the extension surface — `@corpus/contract/client` constructs a
  // transport that bypasses the kit's query cache and its invalidation (see
  // packages/kit/src/index.ts). `apps/ui` is now the kit's only consumer, so it
  // inherits that reason exactly.
  //
  // Measured when this was written: zero imports of `@corpus/contract/client`
  // anywhere under `apps/ui`. The rule pins the state of the tree, it does not
  // create work. `packages/kit` is deliberately out of scope — it *is* the
  // transport — and so are `apps/cli` and `apps/server`, which have no cache to
  // bypass. `scripts/eslint-boundaries.test.ts` proves the rule both directions.
  //
  // The other clause — "never reach into a workspace by path" — was considered
  // and dropped. `no-restricted-imports` matches the specifier text, so a
  // sibling import written the short way (`../../cli/src/x.js` from
  // `apps/server/src`) carries no `apps/` segment and escapes any such pattern,
  // while `rootDir` already rejects the ones it would catch at build time.
  {
    files: ["apps/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@corpus/contract/client"],
              message:
                "apps/ui reaches the server through @corpus/kit, never its own transport — " +
                "a hand-built client bypasses the kit's cache and invalidation.",
            },
          ],
        },
      ],
    },
  },
  // Type-aware rules need a tsconfig project; JS config files have none.
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
);
