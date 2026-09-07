// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// ---- The raw-control ratchet (INFRA-040) ---------------------------------
// UI-191 gave the product one button and one dropdown, in
// `packages/kit/src/components/Controls/`. This keeps it that way.
//
// It is a `no-restricted-syntax` rule and NOT a bespoke scanner, because
// ESLint already runs diff-scoped over the staged TypeScript in
// `.githooks/pre-commit` and whole-repo as `npm run lint` in CI. The check
// therefore rides both gates and adds **zero** hook steps and **zero** CI
// steps — sprint-026 P6, which fails any implementation that adds one.
//
// REJECTED, recorded because the filing asked that one alternative be weighed:
// a small custom rule reading the baseline itself. It would buy per-file
// occurrence *counts* — a file allowed exactly N raw buttons — and cost a
// plugin module plus its own RuleTester suite. The ratchet is file-grained,
// not occurrence-grained, and `no-restricted-syntax` already carries a
// per-selector `message`, which was the only thing that might have forced a
// custom rule.
//
// The whole definition — banned tags, scope, permanent exemptions and the
// grandfathered files — lives in `scripts/raw-controls-baseline.json`, so the
// rule and its baseline cannot drift apart.
// `scripts/raw-controls-ratchet.test.ts` holds the closed census the baseline
// may never exceed, and proves the rule fires with the right message.
//
/**
 * @typedef {{ tag: string, selector: string, message: string }} BannedTag
 * @typedef {{
 *   scope: string[],
 *   outOfScope: string[],
 *   banned: BannedTag[],
 *   primitives: string[],
 *   baseline: Record<string, string[]>,
 * }} RawControlRatchet
 */
/** @type {RawControlRatchet} */
const rawControls = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "scripts/raw-controls-baseline.json"), "utf8"),
);

/**
 * The rule value banning every tag except the ones a file is grandfathered
 * for. `no-restricted-syntax` validates its options strictly, so the `tag` key
 * the JSON carries for grouping is dropped here.
 *
 * @param {readonly string[]} allowed
 */
const banEveryTagExcept = (allowed) => [
  "error",
  ...rawControls.banned
    .filter((entry) => !allowed.includes(entry.tag))
    .map(({ selector, message }) => ({ selector, message })),
];

/**
 * Flat config resolves a rule by last match, so one block per distinct
 * grandfathered tag-set is the only shape that lets a baselined file keep its
 * `<button>` while still being refused a `<select>`. Every entry allows
 * `button` alone today, so this produces exactly one block.
 *
 * @type {Map<string, { allowed: string[], files: string[] }>}
 */
const baselineGroups = new Map();
for (const [file, tags] of Object.entries(rawControls.baseline)) {
  const allowed = [...tags].sort();
  const group = baselineGroups.get(allowed.join(",")) ?? { allowed, files: [] };
  group.files.push(file);
  baselineGroups.set(allowed.join(","), group);
}

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
  // ---- The raw-control ratchet (INFRA-040) -------------------------------
  // Built from `scripts/raw-controls-baseline.json` above. Test files are out
  // of scope on purpose: a fixture that renders a bare `<button>` to drive a
  // roving-focus hook is not product chrome, and banning it would push tests
  // into the kit's styling for no gain.
  {
    name: "corpus/raw-controls",
    files: rawControls.scope,
    ignores: [...rawControls.outOfScope, ...rawControls.primitives],
    rules: { "no-restricted-syntax": banEveryTagExcept([]) },
  },
  // The grandfathered files. Listed last so this rule value wins over the
  // block above for exactly these paths. Deleting an entry from the JSON is
  // what locks a migrated file out for good.
  ...[...baselineGroups.values()].map((group) => ({
    name: `corpus/raw-controls-baseline (grandfathered: ${group.allowed.join(", ")})`,
    files: group.files,
    rules: { "no-restricted-syntax": banEveryTagExcept(group.allowed) },
  })),
  // Type-aware rules need a tsconfig project; JS config files have none.
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
);
