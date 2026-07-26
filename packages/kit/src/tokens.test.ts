import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface KitPackageJson {
  readonly exports: Record<string, unknown>;
  readonly files: readonly string[];
}

const KIT_SRC = import.meta.dirname;
const REPO_ROOT = join(KIT_SRC, "..", "..", "..");

/** Comments in both files talk *about* the tokens, so they must not be parsed. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

const tokensCss = stripComments(readFileSync(join(KIT_SRC, "tokens.css"), "utf8"));
const prototypeHtml = stripComments(readFileSync(join(REPO_ROOT, "design", "index.html"), "utf8"));

/**
 * Prettier rewrites values in `tokens.css` (lowercases hex, drops trailing
 * zeros in decimals, collapses whitespace) but leaves the prototype's inline
 * `<style>` block alone, so "identical value" means identical after that
 * normalisation rather than byte-identical.
 */
function normalizeValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(\.\d*?)0+(?!\d)/g, "$1")
    .replace(/\.(?!\d)/g, "");
}

/** Custom properties declared directly inside `source`, in declaration order. */
function parseCustomProperties(source: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]?/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      declarations.set(name, normalizeValue(value));
    }
  }
  return declarations;
}

/**
 * Body of the first block whose selector matches `pattern`. Brace-counted
 * rather than regex-only so the `@media` wrapper's nested `:root` survives.
 */
function blockBody(source: string, pattern: string): string {
  const opener = new RegExp(`${pattern}\\s*\\{`, "m").exec(source);
  if (opener === null) throw new Error(`No block matching ${pattern}`);
  let depth = 1;
  let index = opener.index + opener[0].length;
  const start = index;
  while (depth > 0 && index < source.length) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    index += 1;
  }
  return source.slice(start, index - 1);
}

const DARK_MEDIA = "@media \\(prefers-color-scheme: dark\\)";

const kitRoot = parseCustomProperties(blockBody(tokensCss, "^:root"));
const kitDarkMedia = parseCustomProperties(
  blockBody(blockBody(tokensCss, DARK_MEDIA), "\\s*:root"),
);
const kitLightAttr = parseCustomProperties(blockBody(tokensCss, ':root\\[data-theme="light"\\]'));
const kitDarkAttr = parseCustomProperties(blockBody(tokensCss, ':root\\[data-theme="dark"\\]'));

const EXPECTED_TOKENS = [
  "--accent",
  "--accent-ink",
  "--accent-wash",
  "--bg",
  "--good",
  "--good-wash",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--line",
  "--line-strong",
  "--mono",
  "--sans",
  "--sepia",
  "--sepia-ink",
  "--sepia-wash",
  "--sepia-wash-2",
  "--serif",
  "--shadow",
  "--shadow-soft",
  "--signal",
  "--signal-wash",
  "--surface",
  "--surface-2",
];

describe("tokens.css", () => {
  it("declares exactly the prototype's colour, shadow and type-family tokens", () => {
    expect([...kitRoot.keys()].sort()).toEqual(EXPECTED_TOKENS);
  });

  it.each([
    [DARK_MEDIA, () => kitDarkMedia],
    ['[data-theme="light"]', () => kitLightAttr],
    ['[data-theme="dark"]', () => kitDarkAttr],
  ])("declares every :root token in the %s block", (_label, block) => {
    expect([...block().keys()].sort()).toEqual(EXPECTED_TOKENS);
  });

  it("declares the explicit theme blocks after the OS-preference media query", () => {
    const mediaIndex = tokensCss.search(new RegExp(`${DARK_MEDIA}\\s*\\{`));
    const lightIndex = tokensCss.indexOf(':root[data-theme="light"]');
    const darkIndex = tokensCss.indexOf(':root[data-theme="dark"]');
    expect(mediaIndex).toBeGreaterThan(-1);
    expect(lightIndex).toBeGreaterThan(mediaIndex);
    expect(darkIndex).toBeGreaterThan(mediaIndex);
  });

  it("keeps the light attribute block equal to the :root defaults", () => {
    expect(Object.fromEntries(kitLightAttr)).toEqual(Object.fromEntries(kitRoot));
  });

  it("keeps the dark attribute block equal to the dark media block", () => {
    expect(Object.fromEntries(kitDarkAttr)).toEqual(Object.fromEntries(kitDarkMedia));
  });

  it("is published through the package's exports map", () => {
    // The file is this package's own manifest, checked in next to this test —
    // a shape assertion, not a trust boundary.
    const pkg = JSON.parse(
      readFileSync(join(KIT_SRC, "..", "package.json"), "utf8"),
    ) as KitPackageJson;
    // Consumers (apps/ui, plugins) import `@corpus/kit/tokens.css`; without
    // this entry Node/Vite ESM resolution rejects the subpath outright.
    expect(pkg.exports["./tokens.css"]).toBe("./src/tokens.css");
    // CSS has no compile step — `tsc` emits nothing for it — so the export
    // points at the source file rather than a copy in `dist/`. That keeps the
    // shipped stylesheet and the one this test parses the same bytes, and
    // means `npm run dev -w apps/ui` works without a prior kit build.
    expect(pkg.files).toContain("src/tokens.css");
  });
});

describe("tokens.css vs design/index.html", () => {
  const prototypeRoot = parseCustomProperties(blockBody(prototypeHtml, "\\s*:root"));
  const prototypeDark = parseCustomProperties(
    blockBody(blockBody(prototypeHtml, DARK_MEDIA), "\\s*:root"),
  );

  it("finds the prototype's own token blocks (guards the parser, not the port)", () => {
    expect(prototypeRoot.size).toBe(EXPECTED_TOKENS.length);
    expect(prototypeDark.size).toBe(21);
  });

  it.each([...prototypeRoot].map(([name, value]) => [name, value] as const))(
    "ports %s from the prototype's :root verbatim",
    (name, value) => {
      expect(kitRoot.get(name)).toBe(value);
      expect(kitLightAttr.get(name)).toBe(value);
    },
  );

  it.each([...prototypeDark].map(([name, value]) => [name, value] as const))(
    "ports %s from the prototype's dark block verbatim",
    (name, value) => {
      expect(kitDarkMedia.get(name)).toBe(value);
      expect(kitDarkAttr.get(name)).toBe(value);
    },
  );
});
