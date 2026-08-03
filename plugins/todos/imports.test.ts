import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The kit-only rule (SPEC.md §10), asserted from inside the plugin.
 *
 * `eslint.config.js` already enforces it across `plugins/**` and
 * `scripts/eslint-boundaries.test.ts` proves the rule fires — but that is a
 * *lint* failure, which only bites when someone runs lint. This test states the
 * same contract as a fact about this directory, so a `vitest` run alone catches
 * the day a component reaches into `apps/ui/src` for "just one helper".
 *
 * It also guards the two omissions that matter most and are easiest to miss:
 * `@corpus/contract/client` (a plugin building its own transport bypasses the
 * kit's cache and its invalidation) and any relative path that climbs out of
 * `plugins/todos/`.
 */

const ROOT = import.meta.dirname;

const ALLOWED_PACKAGES = new Set([
  "@corpus/kit",
  "@corpus/kit/plugin",
  "@corpus/kit/testing",
  // Stylesheet subpaths are kit imports like any other (`packages/kit/src/index.ts`
  // documents them as the way a plugin inherits Corpus theming). The item menu
  // renders `.ac-menu` / `.ac-item` — the app's one positioned-menu surface — and
  // names the sheet rather than assuming whoever mounted it already did.
  "@corpus/kit/autocomplete.css",
  "@corpus/contract",
  "@corpus/contract/plugin",
  "react",
  "react/jsx-runtime",
  "hono",
  "zod",
]);

/** Test-only imports, legal in a `*.test.ts(x)` and nowhere else. */
const TEST_ONLY_PACKAGES = new Set([
  "vitest",
  "@testing-library/react",
  "yaml",
  "node:fs",
  "node:path",
]);

function sources(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(absolute));
    else if (/\.tsx?$/.test(entry.name)) found.push(absolute);
  }
  return found.sort();
}

/** Every module specifier in one file — `import`, `import type` and `export … from`. */
function specifiers(contents: string): readonly string[] {
  return [...contents.matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
}

describe("plugins/todos imports only the kit and the contract", () => {
  const files = sources(ROOT);

  it("finds the plugin's sources at all", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [relative(ROOT, file), file] as const))(
    "%s reaches for nothing it is not allowed",
    (name, file) => {
      const isTest = /\.test\.tsx?$/.test(name);
      for (const specifier of specifiers(readFileSync(file, "utf8"))) {
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(file), specifier);
          expect(target.startsWith(ROOT), `${name} climbs out of the plugin`).toBe(true);
          continue;
        }
        const allowed =
          ALLOWED_PACKAGES.has(specifier) || (isTest && TEST_ONLY_PACKAGES.has(specifier));
        expect(allowed, `${name} imports "${specifier}"`).toBe(true);
      }
    },
  );

  /**
   * The two omissions that matter most, stated as their own assertion because
   * the allowlist above is easy to widen by reflex: `apps/ui` by path, and
   * `@corpus/contract/client` — the transport a plugin building its own
   * requests would use to bypass the kit's cache and its invalidation.
   */
  it("never imports apps/ui internals or the generated client", () => {
    for (const file of files) {
      for (const specifier of specifiers(readFileSync(file, "utf8"))) {
        expect(specifier, `${relative(ROOT, file)} imports apps/ui`).not.toMatch(/apps\/ui/);
        expect(specifier, `${relative(ROOT, file)} imports the generated client`).not.toBe(
          "@corpus/contract/client",
        );
      }
    }
  });

  /**
   * SPEC.md §10 and this issue's Technical Design: "the plugin does not
   * implement anchoring, threads, or highlights — if it needs to, something is
   * wrong". Commenting on a todo document is the core mechanism, untouched.
   */
  it("implements no anchoring, threading or highlight machinery of its own", () => {
    // The scan skips test files: this one names the forbidden symbols in order
    // to look for them.
    for (const file of files.filter((candidate) => !/\.test\.tsx?$/.test(candidate))) {
      const contents = readFileSync(file, "utf8");
      for (const forbidden of ["TextQuoteSelector", "resolveAnchor", "selectorFromSelection"]) {
        expect(contents, `${relative(ROOT, file)} mentions ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
