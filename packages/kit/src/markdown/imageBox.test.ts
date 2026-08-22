import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The reserved image box (UI-129), pinned where it is actually declared.
 *
 * SPEC.md §10's rider signed 2026-08-20 is a **layout** promise — "a value that
 * arrives later than the box holding it" moves nothing — and jsdom implements no
 * layout, so the acceptance test for it is the real-browser geometry spec
 * (`apps/ui/e2e/image-geometry.spec.ts`). What a unit test can still hold is the
 * invariant that spec cannot see until it has already broken: **the three states
 * one renderer draws must reserve the same box.**
 *
 * `CorpusImage` paints a pending chip, then either the picture or a broken chip.
 * If any one of them were sized differently from the others, the reservation
 * would not have removed the jump — it would have moved it one step later, to
 * the moment the bytes land. That is the failure the browser spec is least
 * likely to catch, because it only shows up on the surface whose fixture happens
 * to exercise that particular transition.
 */

const MARKDOWN_CSS = readFileSync(join(import.meta.dirname, "markdown.css"), "utf8");

/**
 * Every declaration `selector` picks up in this stylesheet, in cascade order.
 *
 * The box is declared once for the three states together and the picture's own
 * `object-fit` separately, so a reader that stopped at the first matching rule
 * would answer questions about `.md-img` from half of it.
 */
function declarations(selector: string): Map<string, string> {
  const stripped = MARKDOWN_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Map<string, string>();
  let matched = false;
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors = "", body = ""] = match;
    if (!selectors.split(",").some((part) => part.trim() === selector)) continue;
    matched = true;
    for (const line of body.split(";")) {
      const at = line.indexOf(":");
      if (at === -1) continue;
      found.set(
        line.slice(0, at).trim(),
        line
          .slice(at + 1)
          .trim()
          .replace(/\s+/g, " "),
      );
    }
  }
  if (!matched) throw new Error(`no rule declares ${selector}`);
  return found;
}

const BOX_PROPERTIES = ["width", "max-width", "height", "box-sizing", "aspect-ratio"] as const;

/**
 * The shape the box keeps at every scale (PR #53 review of UI-129), and the
 * mockup's own: `design/index.html` draws `.turn-att-img` at 240×180.
 */
const BOX_RATIO = 4 / 3;

describe("the reserved image box", () => {
  it.each(["md-img", "md-img-pending", "md-img-broken"])(
    "is declared for .%s, so no state is sized by what it holds",
    (className) => {
      const box = declarations(`.${className}`);
      for (const property of BOX_PROPERTIES) expect(box.has(property)).toBe(true);
    },
  );

  it("is the same box in all three states, so the swap between them moves nothing", () => {
    const states = ["md-img", "md-img-pending", "md-img-broken"].map((className) =>
      declarations(`.${className}`),
    );
    for (const property of BOX_PROPERTIES) {
      const values = states.map((box) => box.get(property));
      expect(new Set(values).size).toBe(1);
    }
  });

  it("reserves the reading measure by default, and lets a surface retune it", () => {
    const box = declarations(".md-img");
    // A `max-` pair says nothing about an image that has not decoded, which is
    // the whole defect. The box has to be a stated size, and the custom
    // properties are how a host retunes it without fighting specificity.
    //
    // **The default is the reading measure, not a thumbnail** (PR #53 review).
    // Prose is the surface with no host to retune it — a document body, a
    // turn's message, a plugin's canvas — and an image there carries content
    // someone has to read. A 240px default made the full-screen viewer the
    // ordinary way to read one, which SPEC.md §10's third clause forbids, and
    // on a surface with no viewer mounted there is no viewer to fall back on.
    expect(box.get("width")).toBe("var(--md-img-box-w, 100%)");
    // `auto`, so a surface that states only a width gets the matching height.
    expect(box.get("height")).toBe("var(--md-img-box-h, auto)");
  });

  it("keeps one shape at every scale, so 240px yields the mockup's 180px", () => {
    const box = declarations(".md-img");
    const ratio = box.get("aspect-ratio") ?? "";
    const [width = "", height = ""] = ratio.split("/").map((part) => part.trim());
    expect(Number(width) / Number(height)).toBe(BOX_RATIO);
    // The number `.turn-atts` never has to state: it sets `--md-img-box-w` to
    // the mockup's 240px and this is what makes the height 180px.
    expect(240 / BOX_RATIO).toBe(180);
  });

  it("places the picture inside the box without enlarging a small one", () => {
    const fit = declarations(".md-img");
    // `contain` would blow a 48×36 icon up to fill a box it never asked for.
    expect(fit.get("object-fit")).toBe("scale-down");
  });
});
