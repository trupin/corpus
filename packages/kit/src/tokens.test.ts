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
  "--style-accent",
  "--style-accent-wash",
  "--style-muted",
  "--style-muted-wash",
  "--style-positive",
  "--style-positive-wash",
  "--style-warning",
  "--style-warning-wash",
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
    // `apps/ui` imports `@corpus/kit/tokens.css`; without
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
    // The dark blocks restate colours only, so they carry every token except the
    // three type families — 21 before SPEC.md §5's styling roles, 29 after.
    expect(prototypeDark.size).toBe(29);
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

/**
 * The four colour roles §5 names, measured rather than eyeballed.
 *
 * SPEC.md §5: "the roles are `accent`, `warning`, `positive` and `muted`, each
 * with a light and a dark value, so a document that says `color="warning"`
 * renders correctly in both". "Correctly" for a body is legible, and a styled
 * phrase is ordinary body text at ordinary size — so WCAG AA for normal text,
 * 4.5:1, is the bar. It is checked in both themes because a role that clears it
 * in light and fails in dark is exactly the failure the two values exist to
 * prevent, and no amount of looking at one theme finds it.
 *
 * This is why `--style-warning` is not simply `--signal`. The rust the product
 * uses for chips and destructive actions measures 4.08:1 on the light
 * background — fine behind a chip's larger, bolder label, and short of the bar
 * for a sentence. The light role is darkened to clear it; the dark one, which
 * measures 5.84:1, is `--signal` unchanged.
 */
function channel(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
}

function rgbOf(value: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex !== null) {
    const digits = hex[1] ?? "";
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
      1,
    ];
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (rgba === null) throw new Error(`not a colour: ${value}`);
  const parts = (rgba[1] ?? "").split(",").map((part) => Number(part.trim()));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/** `over` composited onto `under`, so a translucent wash can be measured. */
function composite(over: string, under: string): string {
  const [r1, g1, b1, alpha] = rgbOf(over);
  const [r0, g0, b0] = rgbOf(under);
  const mix = (top: number, bottom: number): number =>
    Math.round(top * alpha + bottom * (1 - alpha));
  return `rgb(${String(mix(r1, r0))}, ${String(mix(g1, g0))}, ${String(mix(b1, b0))})`;
}

function luminance(value: string): number {
  const [r, g, b] = rgbOf(value);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(one: string, two: string): number {
  const a = luminance(one);
  const b = luminance(two);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const ROLES = ["accent", "warning", "positive", "muted"] as const;
const AA_NORMAL_TEXT = 4.5;

describe("the styling colour roles are legible in both themes", () => {
  const themes = [
    ["light", () => kitRoot],
    ["dark", () => kitDarkMedia],
  ] as const;

  it.each(themes.flatMap(([theme, block]) => ROLES.map((role) => [theme, role, block] as const)))(
    "%s: color=%s clears AA on the page background",
    (_theme, role, block) => {
      const tokens = block();
      const ink = tokens.get(`--style-${role}`);
      const background = tokens.get("--bg");
      expect(ink).toBeDefined();
      expect(background).toBeDefined();
      expect(contrast(ink ?? "", background ?? "")).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    },
  );

  it.each(themes.flatMap(([theme, block]) => ROLES.map((role) => [theme, role, block] as const)))(
    "%s: text on the %s highlight clears AA",
    (_theme, role, block) => {
      const tokens = block();
      const wash = tokens.get(`--style-${role}-wash`);
      const background = tokens.get("--bg");
      const ink = tokens.get("--ink");
      expect(wash).toBeDefined();
      // A highlight is a translucent band over the page, and the words on it
      // stay `--ink`. Measuring the wash alone would say nothing about either.
      const painted = composite(wash ?? "", background ?? "");
      expect(contrast(ink ?? "", painted)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    },
  );

  it("keeps the two themes' values distinct, so neither is a copy of the other", () => {
    for (const role of ROLES) {
      expect(kitRoot.get(`--style-${role}`)).not.toBe(kitDarkMedia.get(`--style-${role}`));
    }
  });
});
