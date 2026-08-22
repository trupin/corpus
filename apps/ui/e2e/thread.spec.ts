import { expect, test } from "./coverage";
import { hexToRgb, token } from "./tokens";

/**
 * UI-008's conversation surface, in a real browser — the half that is honest to
 * assert here.
 *
 * **Why only that half.** `playwright.config.ts` starts one Vite and this suite
 * deliberately runs with **no** workspace server on `127.0.0.1:8765`
 * (`smoke.spec.ts` asserts the console strip reads exactly "server
 * unreachable", which is only true while that port is unbound). A thread needs
 * turns, turns need a server, and every write this issue makes has to be
 * checked on disk and in `git log` anyway — so the behavioural half is verified
 * against a real `corpus init` workspace, a real server and a real browser in
 * the issue's E2E Verification Log: the seen-on-display asymmetry, the
 * tri-state toggle read off the wire, the form answer landing in
 * `.corpus/queue/pending/`, the multipart upload and its `413`, turn deletion in
 * `git log -p`, and resolve/reopen from both places. That is the same split
 * `reader.spec.ts` and `board.spec.ts` already document, for the same reason.
 *
 * What is left is not nothing. The thread card, the turn stream's delete
 * arming, the composer and its foot, the pending row, attachments in both
 * states, the live form controls and the shared autocomplete menu are all
 * **stylesheet** contracts pinned by `design/index.html`, and the stylesheet is
 * the one this page's bundle loads. Probes carrying the real class names are
 * mounted into the real document and measured with `getComputedStyle`.
 */

/** Mounts markup into the live page and returns computed styles for each probe. */
async function measure(
  page: import("@playwright/test").Page,
  html: string,
  probes: readonly (readonly [string, readonly string[]])[],
): Promise<Record<string, Record<string, string>>> {
  return page.evaluate(
    ([markup, wanted]) => {
      const host = document.createElement("div");
      host.id = "ui008-probe";
      host.innerHTML = markup;
      document.body.append(host);
      const out: Record<string, Record<string, string>> = {};
      for (const [selector, properties] of wanted) {
        const element = host.querySelector(selector);
        const style = element === null ? null : getComputedStyle(element);
        out[selector] = Object.fromEntries(
          properties.map((property) => [property, style?.getPropertyValue(property) ?? ""]),
        );
      }
      host.remove();
      return out;
    },
    [html, probes] as const,
  );
}

const LIGHT_ACCENT = hexToRgb(token(':root\\[data-theme="light"\\]', "--accent"));
const LIGHT_ACCENT_INK = hexToRgb(token(':root\\[data-theme="light"\\]', "--accent-ink"));
const LIGHT_SIGNAL = hexToRgb(token(':root\\[data-theme="light"\\]', "--signal"));
const LIGHT_INK_3 = hexToRgb(token(':root\\[data-theme="light"\\]', "--ink-3"));
const LIGHT_SURFACE = hexToRgb(token(':root\\[data-theme="light"\\]', "--surface"));
const LIGHT_SURFACE_2 = hexToRgb(token(':root\\[data-theme="light"\\]', "--surface-2"));
const LIGHT_BG = hexToRgb(token(':root\\[data-theme="light"\\]', "--bg"));

const CARD = `
  <div class="thread-card">
    <div class="t-head">
      <span class="t-quote">"a quote"</span>
      <span class="chip t-status">open</span>
      <button class="t-resolve">✓ resolve</button>
      <button class="t-collapse">–</button>
    </div>
    <div class="t-context">on Parent · at "a quote"</div>
    <div class="turns">
      <div class="turn">
        <div class="turn-who"><span class="who">user</span><span>Jul 19, 10:05</span>
          <button class="turn-del">✕</button></div>
        <div class="turn-body">first</div>
      </div>
      <div class="turn">
        <div class="turn-who"><span class="who agent">agent</span><span>Jul 19, 10:07</span></div>
        <div class="turn-body">second</div>
        <div class="turn-trace">edited the model doc</div>
      </div>
    </div>
    <div class="working"><span class="working-dot"></span> agent is working…</div>
  </div>`;

test.describe("the thread card's shipped stylesheet", () => {
  test("is the prototype's card, computed", async ({ page }) => {
    await page.goto("/");
    const styles = await measure(page, `${CARD}<div class="thread-card resolved"></div>`, [
      [
        ".thread-card",
        [
          "background-color",
          "border-left-width",
          "border-left-color",
          "border-top-width",
          "border-radius",
          "max-width",
        ],
      ],
      [".thread-card.resolved", ["border-left-color", "opacity"]],
      [".t-quote", ["font-style", "font-size", "color"]],
      [".t-status", ["margin-left"]],
      [".t-context", ["font-size", "color"]],
    ]);

    expect(styles[".thread-card"]?.["background-color"]).toBe(LIGHT_SURFACE_2);
    // 3px accent on the left, hairline everywhere else.
    expect(styles[".thread-card"]?.["border-left-width"]).toBe("3px");
    expect(styles[".thread-card"]?.["border-left-color"]).toBe(LIGHT_ACCENT);
    expect(styles[".thread-card"]?.["border-top-width"]).toBe("1px");
    expect(styles[".thread-card"]?.["border-radius"]).toBe("10px");
    expect(styles[".thread-card.resolved"]?.["border-left-color"]).toBe(LIGHT_INK_3);
    expect(styles[".thread-card.resolved"]?.["opacity"]).toBe("0.75");
    expect(styles[".t-quote"]?.["font-style"]).toBe("italic");
    expect(styles[".t-quote"]?.["font-size"]).toBe("12.5px");
    // The status chip is pushed to the far end of the head.
    expect(styles[".t-status"]?.["margin-left"]).not.toBe("0px");
    expect(styles[".t-context"]?.["font-size"]).toBe("11px");
    expect(styles[".t-context"]?.["color"]).toBe(LIGHT_INK_3);
  });

  /**
   * The fold control's hit target and its distance from Resolve (UI-096).
   *
   * jsdom has no layout, so this is the only place either can be asserted. What
   * the defect was: `.t-collapse` was `position: absolute; top: 8px; right: 10px`
   * with `font-size: 13px; padding: 0 5px; line-height: 1` — a **13 × 15px**
   * target dropped into the same corner `margin-left: auto` pushes the status
   * chip and Resolve into. The two were not laid out in relation to each other;
   * they merely landed in the same place, and the cost of missing was resolving
   * a conversation you meant to fold.
   *
   * It is back in the head's flow, which is where `design/index.html` has always
   * drawn it (`.t-collapse { margin-left: 4px; … }`) — and being in flow is also
   * what keeps the spacing when the quote wraps to two lines, since `.t-head`
   * wraps and a corner control does not move with it.
   */
  test("gives the fold control a real target, laid out beside resolve", async ({ page }) => {
    await page.goto("/");
    const box = await page.evaluate((markup) => {
      const host = document.createElement("div");
      host.innerHTML = markup;
      document.body.append(host);
      const rect = (selector: string): DOMRect | null =>
        host.querySelector(selector)?.getBoundingClientRect() ?? null;
      const head = rect(".t-head");
      const collapse = rect(".t-collapse");
      const resolve = rect(".t-resolve");
      const style = getComputedStyle(host.querySelector(".t-collapse") as Element);
      const out =
        head === null || collapse === null || resolve === null
          ? null
          : {
              width: Math.round(collapse.width),
              height: Math.round(collapse.height),
              gap: Math.round(collapse.left - resolve.right),
              // In flow, not painted over the row.
              positioned: style.position,
              // Centred on the row rather than contained by it: the target is
              // deliberately taller than the head's 18px chips, and the negative
              // block margin is what stops that height reaching the card.
              offCentre: Math.abs(
                (collapse.top + collapse.bottom) / 2 - (head.top + head.bottom) / 2,
              ),
              headHeight: Math.round(head.height),
            };
      /*
       * The head's height **without** the control, measured in the same layout —
       * which is the claim "growing the hit box must not grow the card", stated
       * as a comparison rather than as a number somebody typed.
       */
      host.querySelector(".t-collapse")?.remove();
      const withoutControl = Math.round(rect(".t-head")?.height ?? -1);
      host.remove();
      return out === null ? null : { ...out, withoutControl };
    }, CARD);

    expect(box).not.toBeNull();
    // The floor is 24px; the shipped box is 26 × 26.
    expect(box?.width).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeGreaterThanOrEqual(24);
    // Real separation from the control that resolves the conversation: the
    // head's own 8px gap plus the control's 4px, as the mockup draws it.
    expect(box?.gap).toBeGreaterThanOrEqual(10);
    expect(box?.positioned).toBe("static");
    expect(box?.offCentre ?? 99).toBeLessThanOrEqual(1);
    // Growing the target must not grow the card: the negative block margin gives
    // the extra height back, so the head is the same height with the control and
    // without it.
    expect(box?.headHeight).toBe(box?.withoutControl);
  });

  test("separates turns with hairlines and marks the agent in accent", async ({ page }) => {
    await page.goto("/");
    const styles = await measure(page, CARD, [
      [".turn", ["border-top-width", "padding-top", "padding-bottom"]],
      [".turn-who", ["font-size"]],
      [".turn-who .who", ["font-weight", "text-transform", "letter-spacing"]],
      [".turn-who .who.agent", ["color"]],
      [".turn-trace", ["font-size", "color"]],
    ]);

    expect(styles[".turn"]?.["padding-top"]).toBe("8px");
    expect(styles[".turn"]?.["padding-bottom"]).toBe("8px");
    expect(styles[".turn-who"]?.["font-size"]).toBe("10.5px");
    expect(styles[".turn-who .who"]?.["font-weight"]).toBe("700");
    expect(styles[".turn-who .who"]?.["text-transform"]).toBe("uppercase");
    expect(styles[".turn-who .who"]?.["letter-spacing"]).toBe("0.525px");
    expect(styles[".turn-who .who.agent"]?.["color"]).toBe(LIGHT_ACCENT_INK);
    expect(styles[".turn-trace"]?.["font-size"]).toBe("11px");
    expect(styles[".turn-trace"]?.["color"]).toBe(LIGHT_INK_3);

    // The first turn carries no rule; every later one does.
    const borders = await page.evaluate((markup) => {
      const host = document.createElement("div");
      host.innerHTML = markup;
      document.body.append(host);
      const values = [...host.querySelectorAll(".turn")].map(
        (n) => getComputedStyle(n).borderTopWidth,
      );
      host.remove();
      return values;
    }, CARD);
    expect(borders).toEqual(["0px", "1px"]);
  });

  /** The arrow is CSS content, never a character in the document's bytes. */
  test("supplies the trace arrow from CSS", async ({ page }) => {
    await page.goto("/");
    const content = await page.evaluate((markup) => {
      const host = document.createElement("div");
      host.innerHTML = markup;
      document.body.append(host);
      const trace = host.querySelector(".turn-trace");
      const value = trace === null ? "" : getComputedStyle(trace, "::before").content;
      const text = trace?.textContent ?? "";
      host.remove();
      return { value, text };
    }, CARD);
    expect(content.value).toContain("↳");
    expect(content.text).not.toContain("↳");
  });

  test("hides the delete control until hover and arms it in the signal colour", async ({
    page,
  }) => {
    await page.goto("/");
    const styles = await measure(page, `${CARD}<button class="turn-del armed">delete?</button>`, [
      [".turn .turn-del", ["opacity"]],
      [".turn-del.armed", ["opacity", "color", "font-size"]],
    ]);
    expect(styles[".turn .turn-del"]?.["opacity"]).toBe("0");
    expect(styles[".turn-del.armed"]?.["opacity"]).toBe("1");
    expect(styles[".turn-del.armed"]?.["color"]).toBe(LIGHT_SIGNAL);
    expect(styles[".turn-del.armed"]?.["font-size"]).toBe("10px");
  });

  test("gives the pending row a hairline and a dot that respects reduced motion", async ({
    page,
  }) => {
    await page.goto("/");
    const styles = await measure(page, CARD, [
      [".working", ["border-top-width", "font-size", "color", "padding-top"]],
      [".working-dot", ["width", "height", "border-radius", "animation-name"]],
    ]);
    expect(styles[".working"]?.["border-top-width"]).toBe("1px");
    expect(styles[".working"]?.["font-size"]).toBe("12px");
    expect(styles[".working"]?.["color"]).toBe(LIGHT_INK_3);
    expect(styles[".working"]?.["padding-top"]).toBe("9px");
    expect(styles[".working-dot"]?.["width"]).toBe("7px");
    expect(styles[".working-dot"]?.["height"]).toBe("7px");
    expect(styles[".working-dot"]?.["animation-name"]).toBe("pulse");

    // `global.css`'s single guard block, extended rather than re-declared.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await measure(page, CARD, [[".working-dot", ["animation-name"]]]);
    expect(reduced[".working-dot"]?.["animation-name"]).toBe("none");
    await page.emulateMedia({ reducedMotion: null });
  });
});

const COMPOSER = `
  <div class="composer">
    <div class="pending-atts"><span class="att-chip"><img alt="" src=""/>shot.png<button>✕</button></span></div>
    <div class="composer-grow" data-replicated-value="one&#10;two&#10;three">
      <textarea rows="1" placeholder="Reply — @ route · / skill · [[ link · paste or drop files" aria-label="Reply">one
two
three</textarea>
    </div>
    <div class="composer-foot">
      <button class="clip">📎</button>
      <button class="toggle on">◉ ask agent</button>
      <span class="composer-hint">thread stays open</span>
      <button class="send">Reply ⌘↵</button>
    </div>
  </div>
  <div class="composer dropping"></div>`;

test.describe("the composer's shipped stylesheet", () => {
  test("is the prototype's composer and foot", async ({ page }) => {
    await page.goto("/");
    const styles = await measure(page, COMPOSER, [
      [
        ".composer",
        ["background-color", "border-top-width", "border-radius", "padding-top", "padding-left"],
      ],
      [".composer.dropping", ["border-top-color", "background-color"]],
      [".composer-foot", ["font-size", "color"]],
      [".composer-foot .toggle.on", ["color"]],
      [".composer-foot .send", ["margin-left", "color", "font-weight"]],
    ]);

    expect(styles[".composer"]?.["background-color"]).toBe(LIGHT_SURFACE);
    expect(styles[".composer"]?.["border-top-width"]).toBe("1px");
    expect(styles[".composer"]?.["border-radius"]).toBe("8px");
    expect(styles[".composer"]?.["padding-top"]).toBe("8px");
    expect(styles[".composer"]?.["padding-left"]).toBe("10px");
    expect(styles[".composer.dropping"]?.["border-top-color"]).toBe(LIGHT_ACCENT);
    expect(styles[".composer-foot"]?.["font-size"]).toBe("10.5px");
    expect(styles[".composer-foot"]?.["color"]).toBe(LIGHT_INK_3);
    expect(styles[".composer-foot .toggle.on"]?.["color"]).toBe(LIGHT_ACCENT_INK);
    expect(styles[".composer-foot .send"]?.["margin-left"]).not.toBe("0px");
    expect(styles[".composer-foot .send"]?.["color"]).toBe(LIGHT_ACCENT_INK);
    expect(styles[".composer-foot .send"]?.["font-weight"]).toBe("600");
  });

  /**
   * UI-052 made the field a textarea (SPEC.md §10's `↵`-is-a-newline contract),
   * and the whole risk of that swap is visual: a textarea arrives with a border,
   * a scrollbar and the browser's own font unless every one of them is turned
   * off. Measured in the real cascade, because that is where the defaults are.
   */
  test("keeps the field looking like the mockup's one-line input, and grows it", async ({
    page,
  }) => {
    await page.goto("/");
    const styles = await measure(page, COMPOSER, [
      [".composer-grow", ["display", "overflow-y"]],
      [
        ".composer-grow > textarea",
        ["border-style", "background-color", "resize", "overflow", "padding", "font-family"],
      ],
      [".composer-foot", ["font-family"]],
    ]);
    expect(styles[".composer-grow"]?.["display"]).toBe("grid");
    expect(styles[".composer-grow"]?.["overflow-y"]).toBe("auto");
    const field = styles[".composer-grow > textarea"] ?? {};
    expect(field["border-style"]).toBe("none");
    expect(field["background-color"]).toBe("rgba(0, 0, 0, 0)");
    expect(field["resize"]).toBe("none");
    expect(field["overflow"]).toBe("hidden");
    expect(field["padding"]).toBe("0px");
    // `font: inherit` — the card's serif, never the textarea's monospace default.
    expect(field["font-family"]).not.toBe(styles[".composer-foot"]?.["font-family"]);

    // Three lines of value make a three-line box: the mirror is what measures it.
    const heights = await page.evaluate((markup) => {
      const host = document.createElement("div");
      host.innerHTML = markup;
      document.body.append(host);
      const field = host.querySelector("textarea") as HTMLTextAreaElement;
      const grown = field.getBoundingClientRect().height;
      const wrap = host.querySelector(".composer-grow") as HTMLElement;
      wrap.dataset["replicatedValue"] = "";
      field.value = "";
      const empty = field.getBoundingClientRect().height;
      host.remove();
      return { grown, empty };
    }, COMPOSER);
    expect(heights.grown).toBeGreaterThan(heights.empty * 2);
  });

  test("previews a pending attachment at 34px and renders a posted one in both forms", async ({
    page,
  }) => {
    await page.goto("/");
    const styles = await measure(
      page,
      // `md-img turn-att-img` inside `.turn-atts` is what the thread renders,
      // and every part of that matters since UI-129: the kit's `.md-img` carries
      // the reserved box, the strip carries the 240px that makes it the
      // mockup's *thumbnail* rather than the kit's reading-width default, and
      // the host class carries the frame. A probe on any one of the three would
      // be measuring part of the element the app draws.
      `${COMPOSER}<div class="turn-atts"><img class="md-img turn-att-img" alt=""/></div><span class="att-file">📄 policy.pdf</span>`,
      [
        [".att-chip", ["border-radius", "font-size", "background-color"]],
        [".att-chip img", ["height"]],
        [".turn-att-img", ["width", "height", "border-radius", "border-top-width"]],
        [".att-file", ["border-radius", "font-size", "background-color"]],
      ],
    );
    expect(styles[".att-chip"]?.["border-radius"]).toBe("7px");
    expect(styles[".att-chip"]?.["font-size"]).toBe("11px");
    expect(styles[".att-chip"]?.["background-color"]).toBe(LIGHT_SURFACE_2);
    expect(styles[".att-chip img"]?.["height"]).toBe("34px");
    /*
     * `design/index.html`'s 240×180, now **stated** rather than capped
     * (UI-129). A `max-` pair says nothing about an image that has not decoded
     * yet, which is the whole of what that issue fixed: the box has to be the
     * same before the bytes, during them and after them.
     *
     * The height is not stated anywhere in the product — `.turn-atts` sets the
     * width and the kit's `aspect-ratio: 4 / 3` produces the 180. Asserting it
     * here is asserting that the two halves of the mockup's figure still agree
     * (PR #53 review of UI-129).
     */
    expect(styles[".turn-att-img"]?.["width"]).toBe("240px");
    expect(styles[".turn-att-img"]?.["height"]).toBe("180px");
    expect(styles[".turn-att-img"]?.["border-radius"]).toBe("8px");
    expect(styles[".att-file"]?.["border-radius"]).toBe("7px");
    expect(styles[".att-file"]?.["background-color"]).toBe(LIGHT_SURFACE_2);
  });
});

test.describe("forms and the shared autocomplete", () => {
  test("renders option cards with a picked state and an accent submit", async ({ page }) => {
    await page.goto("/");
    const styles = await measure(
      page,
      `<div class="form-comment">
         <button class="form-opt"><span>Lemonade</span><span class="price">$1,840/yr</span></button>
         <button class="form-opt picked"><span>Chubb</span></button>
         <button class="form-submit">Answer</button>
       </div>`,
      [
        [".form-opt", ["border-radius", "padding-top", "padding-left", "background-color"]],
        [".form-opt.picked", ["border-top-color"]],
        [".form-opt .price", ["margin-left", "font-size"]],
        [".form-submit", ["background-color", "color", "border-radius", "font-weight"]],
      ],
    );
    expect(styles[".form-opt"]?.["border-radius"]).toBe("8px");
    expect(styles[".form-opt"]?.["padding-top"]).toBe("7px");
    expect(styles[".form-opt"]?.["padding-left"]).toBe("10px");
    expect(styles[".form-opt"]?.["background-color"]).toBe(LIGHT_SURFACE);
    expect(styles[".form-opt.picked"]?.["border-top-color"]).toBe(LIGHT_ACCENT);
    expect(styles[".form-opt .price"]?.["margin-left"]).not.toBe("0px");
    expect(styles[".form-opt .price"]?.["font-size"]).toBe("11px");
    expect(styles[".form-submit"]?.["background-color"]).toBe(LIGHT_ACCENT);
    expect(styles[".form-submit"]?.["color"]).toBe(LIGHT_BG);
    expect(styles[".form-submit"]?.["border-radius"]).toBe("7px");
    expect(styles[".form-submit"]?.["font-weight"]).toBe("600");
  });

  /** The kit ships the menu with the component that emits it. */
  test("ships the prototype's `.ac-menu` from `@corpus/kit`", async ({ page }) => {
    await page.goto("/");
    const styles = await measure(
      page,
      `<div class="ac-menu"></div>
       <div class="ac-menu open">
         <button class="ac-item"><span class="k">agent</span><span class="d">the agent</span></button>
       </div>`,
      [
        [".ac-menu", ["display"]],
        [
          ".ac-menu.open",
          [
            "position",
            "display",
            "min-width",
            "max-height",
            "overflow-y",
            "border-radius",
            "padding-top",
          ],
        ],
        [".ac-item", ["display", "padding-top", "padding-left", "font-size", "border-radius"]],
        [".ac-item .k", ["color"]],
        [".ac-item .d", ["font-size", "color"]],
      ],
    );
    // Closed by default; `.open` is what shows it.
    expect(styles[".ac-menu"]?.["display"]).toBe("none");
    expect(styles[".ac-menu.open"]?.["display"]).toBe("block");
    expect(styles[".ac-menu.open"]?.["position"]).toBe("fixed");
    expect(styles[".ac-menu.open"]?.["min-width"]).toBe("250px");
    expect(styles[".ac-menu.open"]?.["max-height"]).toBe("200px");
    expect(styles[".ac-menu.open"]?.["overflow-y"]).toBe("auto");
    expect(styles[".ac-menu.open"]?.["border-radius"]).toBe("9px");
    expect(styles[".ac-menu.open"]?.["padding-top"]).toBe("4px");
    expect(styles[".ac-item"]?.["padding-top"]).toBe("6px");
    expect(styles[".ac-item"]?.["padding-left"]).toBe("9px");
    expect(styles[".ac-item"]?.["font-size"]).toBe("12.5px");
    expect(styles[".ac-item .k"]?.["color"]).toBe(LIGHT_ACCENT_INK);
    expect(styles[".ac-item .d"]?.["font-size"]).toBe("11px");
    expect(styles[".ac-item .d"]?.["color"]).toBe(LIGHT_INK_3);
  });

  /**
   * SPEC.md §6's recursion, and the point at which it stops indenting: a card
   * nested past the cap sits at its parent's own left edge, so depths 3 and 4
   * share a line and a composer never shrinks to nothing.
   */
  test("stops indenting nested threads past the cap", async ({ page }) => {
    await page.goto("/");
    const offsets = await page.evaluate(() => {
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;left:0;top:0;width:700px";
      host.innerHTML = `
        <div class="thread-card" data-d="0"><div class="turns">
          <div class="child-threads"><div class="thread-card" data-d="1"><div class="turns">
            <div class="child-threads"><div class="thread-card" data-d="2"><div class="turns">
              <div class="child-threads"><div class="thread-card flush" data-d="3"><div class="turns">
                <div class="child-threads flush"><div class="thread-card flush" data-d="4"></div></div>
              </div></div></div>
            </div></div></div>
          </div></div></div>
        </div></div>`;
      document.body.append(host);
      const lefts = [...host.querySelectorAll("[data-d]")].map((n) =>
        Math.round(n.getBoundingClientRect().left),
      );
      host.remove();
      return lefts;
    });
    expect(offsets[0]).toBeLessThan(offsets[1] ?? 0);
    expect(offsets[1]).toBeLessThan(offsets[2] ?? 0);
    expect(offsets[2]).toBeLessThan(offsets[3] ?? 0);
    // Depth 3 and depth 4 land on the same line — the cap.
    expect(offsets[4]).toBe(offsets[3]);
  });
});
