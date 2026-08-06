import { expect, test } from "./coverage";

/**
 * UI-007's anchors, in a real browser — the half that is honest to assert here.
 *
 * The same split `editor.spec.ts` and `reader.spec.ts` document:
 * `playwright.config.ts` starts one Vite whose proxy target is fixed, and this
 * suite runs with **no** workspace server on `127.0.0.1:8765`, because
 * `smoke.spec.ts` asserts the console strip reads exactly "server unreachable"
 * and that is only true while the port is unbound. An anchor needs a document,
 * a document needs a server, and a thread needs both.
 *
 * So the behavioural half — selecting prose, the comment popover, the thread
 * landing with a working selector in the parent's frontmatter, highlights
 * surviving typing, reconciliation moving or orphaning them, chips and margin
 * cards — is verified against a real `corpus init` workspace, a real server and
 * a real browser in the issue's E2E Verification Log, with the file on disk and
 * `git show` checked after every mutation.
 *
 * What is left is not nothing. Every rule below is a **stylesheet** contract
 * pinned by `design/index.html` (`.anchor-hl`, `.anchor-pip`, `.t-chip`,
 * `.focus-inner.with-margin`, `.focus-margin` and its `::before` connector), and
 * the stylesheet is shipped by the bundle this page loads. Probe elements
 * carrying the real class names are mounted into the real document and measured
 * with `getComputedStyle` — the CSS under test is the CSS that ships.
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
      host.id = "ui007-probe";
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

/** A design token's value, read off the live document. */
async function token(page: import("@playwright/test").Page, name: string): Promise<string> {
  return page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator(".board").waitFor();
});

test.describe("the highlight", () => {
  test("is an accent wash with a 2px accent underline and a squared-off bottom", async ({
    page,
  }) => {
    const styles = await measure(
      page,
      `<div class="doc-body"><p>rate <span class="anchor-hl" data-thread="th_1">6.1%</span></p></div>`,
      [
        [
          ".anchor-hl",
          [
            "background-color",
            "border-bottom-width",
            "border-bottom-style",
            "border-bottom-color",
            "border-top-left-radius",
            "border-bottom-left-radius",
            "padding-left",
            "cursor",
          ],
        ],
      ],
    );
    const highlight = styles[".anchor-hl"];
    // `design/index.html`: background var(--accent-wash); border-bottom 2px
    // solid var(--accent); radius 3px 3px 0 0; padding 0 2px; cursor pointer.
    expect(highlight?.["border-bottom-width"]).toBe("2px");
    expect(highlight?.["border-bottom-style"]).toBe("solid");
    expect(highlight?.["border-top-left-radius"]).toBe("3px");
    expect(highlight?.["border-bottom-left-radius"]).toBe("0px");
    expect(highlight?.["padding-left"]).toBe("2px");
    expect(highlight?.["cursor"]).toBe("pointer");
    expect(highlight?.["background-color"]).not.toBe("rgba(0, 0, 0, 0)");
    expect(await token(page, "--accent-wash")).not.toBe("");
  });

  test("goes dotted and colourless when its thread is resolved", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="doc-body"><p><span class="anchor-hl resolved">6.1%</span></p></div>`,
      [[".anchor-hl", ["background-color", "border-bottom-style", "border-bottom-color"]]],
    );
    const highlight = styles[".anchor-hl"];
    expect(highlight?.["border-bottom-style"]).toBe("dotted");
    // `background: none` computes to a fully transparent colour.
    expect(highlight?.["background-color"]).toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("the pip", () => {
  test("is a small mono superscript pill in the accent colour", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="doc-body"><p><span class="anchor-hl">6.1%</span><span class="anchor-pip">3</span></p></div>`,
      [
        [
          ".anchor-pip",
          [
            "font-size",
            "vertical-align",
            "background-color",
            "color",
            "border-top-left-radius",
            "padding-left",
            "margin-left",
            "font-family",
          ],
        ],
      ],
    );
    const pip = styles[".anchor-pip"];
    expect(pip?.["font-size"]).toBe("10px");
    expect(pip?.["vertical-align"]).toBe("super");
    expect(pip?.["border-top-left-radius"]).toBe("99px");
    expect(pip?.["padding-left"]).toBe("5px");
    expect(pip?.["margin-left"]).toBe("3px");
    expect(pip?.["font-family"]).toContain("mono");
  });

  test("goes grey with its highlight when the thread is resolved", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="doc-body"><p><span class="anchor-hl resolved">x</span><span class="anchor-pip resolved">2</span></p></div>`,
      [[".anchor-pip", ["background-color"]]],
    );
    const grey = await token(page, "--ink-3");
    expect(grey).not.toBe("");
    expect(styles[".anchor-pip"]?.["background-color"]).not.toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("the margin column", () => {
  test("is a two-column grid with a 30px gap and a 300px margin", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="focus-inner with-margin">
         <div class="doc-main"><p>body</p></div>
         <div class="focus-margin"></div>
       </div>`,
      [[".focus-inner", ["display", "grid-template-columns", "column-gap", "align-items"]]],
    );
    const inner = styles[".focus-inner"];
    expect(inner?.["display"]).toBe("grid");
    expect(inner?.["column-gap"]).toBe("30px");
    expect(inner?.["align-items"]).toBe("start");
    // `minmax(0, 1fr) 300px` resolves to two tracks, the second 300px wide.
    expect(inner?.["grid-template-columns"]?.split(" ").at(-1)).toBe("300px");
  });

  /**
   * The cascade positions the **panel**, not the card inside it (UI-077): a
   * conversation in the margin is a card when it is expanded and a single line
   * when it is folded, and both have to sit beside their anchor. A fold that
   * dropped out of the layout would leave the ones below it stacked where the
   * card used to be.
   */
  test("positions its conversations absolutely, edge to edge, folded or not", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="focus-inner with-margin">
         <div class="doc-main"></div>
         <div class="focus-margin">
           <div class="thread-slot expanded" data-thread-panel="th_1" id="open">
             <div class="thread-card">card</div>
           </div>
           <div class="thread-slot collapsed" data-thread-panel="th_2" id="folded">
             <button class="t-chip" data-thread-expand="th_2">line</button>
           </div>
         </div>
       </div>`,
      [
        ["#open", ["position", "left", "right", "margin-top", "max-width", "display"]],
        ["#folded", ["position", "left", "right", "max-width", "display"]],
        ["#open > .thread-card", ["margin-top", "max-width"]],
      ],
    );
    const card = styles["#open"];
    expect(card?.["position"]).toBe("absolute");
    expect(card?.["left"]).toBe("0px");
    expect(card?.["right"]).toBe("0px");
    expect(card?.["margin-top"]).toBe("0px");
    expect(card?.["max-width"]).toBe("none");
    expect(card?.["display"]).toBe("block");
    // The card inside sheds its own measure and margin to the panel's.
    expect(styles["#open > .thread-card"]?.["margin-top"]).toBe("0px");
    expect(styles["#open > .thread-card"]?.["max-width"]).toBe("none");
    // A folded conversation is laid out exactly the same way.
    const folded = styles["#folded"];
    expect(folded?.["position"]).toBe("absolute");
    expect(folded?.["left"]).toBe("0px");
    expect(folded?.["right"]).toBe("0px");
    expect(folded?.["max-width"]).toBe("none");
  });

  test("draws the 23px connector back to the text", async ({ page }) => {
    const connector = await page.evaluate(() => {
      const host = document.createElement("div");
      host.innerHTML = `<div class="focus-inner with-margin">
        <div class="doc-main"></div>
        <div class="focus-margin">
          <div class="thread-slot expanded" data-thread-panel="th_1">
            <div class="thread-card">card</div>
          </div>
        </div>
      </div>`;
      document.body.append(host);
      const card = host.querySelector("[data-thread-panel]");
      const style = card === null ? null : getComputedStyle(card, "::before");
      const out = {
        content: style?.getPropertyValue("content") ?? "",
        left: style?.getPropertyValue("left") ?? "",
        top: style?.getPropertyValue("top") ?? "",
        width: style?.getPropertyValue("width") ?? "",
        height: style?.getPropertyValue("height") ?? "",
        position: style?.getPropertyValue("position") ?? "",
      };
      host.remove();
      return out;
    });
    expect(connector.content).toBe('""');
    expect(connector.position).toBe("absolute");
    expect(connector.left).toBe("-23px");
    expect(connector.top).toBe("16px");
    expect(connector.width).toBe("23px");
    expect(connector.height).toBe("1px");
  });

  test("hides the chips it replaces", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="focus-inner with-margin">
         <div class="doc-main"><button class="t-chip">💬 2 · agent</button></div>
         <div class="focus-margin"></div>
       </div>`,
      [[".t-chip", ["display"]]],
    );
    expect(styles[".t-chip"]?.["display"]).toBe("none");
  });
});

test.describe("the comment composer", () => {
  test("is a fixed popover above the reader, hidden until it is open", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="comment-pop"><div class="cm-quote">“x”</div></div>
       <div class="comment-pop open"><textarea class="cm-input"></textarea></div>`,
      [
        [".comment-pop", ["display"]],
        [".comment-pop.open", ["display", "position", "width"]],
        [".cm-input", ["resize", "font-size"]],
      ],
    );
    expect(styles[".comment-pop"]?.["display"]).toBe("none");
    expect(styles[".comment-pop.open"]?.["display"]).toBe("block");
    expect(styles[".comment-pop.open"]?.["position"]).toBe("fixed");
    expect(styles[".cm-input"]?.["resize"]).toBe("vertical");
  });
});

test.describe("the anchor's chip", () => {
  test("is the prototype's pill, and its slot takes no caret", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="doc-body"><div class="anchor-slot" contenteditable="false">
         <div class="thread-slot"><button class="t-chip">💬 3 · agent</button></div>
       </div></div>`,
      [
        [".t-chip", ["font-size", "border-top-left-radius", "padding-left", "font-family"]],
        [".anchor-slot", ["user-select"]],
      ],
    );
    expect(styles[".t-chip"]?.["font-size"]).toBe("10.5px");
    expect(styles[".t-chip"]?.["border-top-left-radius"]).toBe("99px");
    expect(styles[".t-chip"]?.["padding-left"]).toBe("10px");
    expect(styles[".t-chip"]?.["font-family"]).toContain("mono");
    expect(styles[".anchor-slot"]?.["user-select"]).toBe("none");
  });
});
