import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-005's reader, in a real browser — the half that is honest to assert here.
 *
 * **Why only that half.** `playwright.config.ts` starts one Vite whose proxy
 * target is fixed, and this suite deliberately runs with **no** workspace server
 * on `127.0.0.1:8765`: `smoke.spec.ts` asserts the console strip reads exactly
 * "server unreachable", which is only true while that port is unbound. A reader
 * needs a document, and a document needs a server, so the behavioural half —
 * opening a row, following `[[refs]]`, the navigation stack, the ⋯ menu's writes,
 * the archived banner — is verified against a real `corpus init` workspace, a real
 * server and this same browser in the issue's E2E Verification Log, with the
 * disk and `git log` checked after every mutation. That is the same split
 * `board.spec.ts` documents for UI-003, and for the same reason.
 *
 * What is left is not nothing. The reading measures, the focus overlay's
 * geometry, the column's widening transition and the unresolved-ref treatment
 * are all **stylesheet** contracts pinned by `design/index.html`, and the
 * stylesheet is shipped by the bundle this page loads. Probe elements carrying
 * the real class names are mounted into the real document and measured with
 * `getComputedStyle` — the CSS under test is the CSS that ships.
 */

/**
 * The `ch` count of an element's `max-width`, resolved against that element's
 * own font — which is what makes "62ch" and "66ch" comparable when the two
 * measures are set at different font sizes and different families.
 */
async function measureCh(
  page: import("@playwright/test").Page,
  html: string,
  selector: string,
): Promise<number> {
  return page.evaluate(
    ([markup, target]) => {
      const host = document.createElement("div");
      host.innerHTML = markup;
      document.body.append(host);
      const element = host.querySelector(target);
      if (element === null) {
        host.remove();
        return 0;
      }
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;visibility:hidden;width:1ch";
      probe.style.font = getComputedStyle(element).font;
      element.append(probe);
      const one = probe.getBoundingClientRect().width;
      const max = Number.parseFloat(getComputedStyle(element).maxWidth);
      host.remove();
      return one === 0 ? 0 : Math.round(max / one);
    },
    [html, selector] as const,
  );
}

/** Mounts markup into the live page and returns computed styles for each probe. */
async function measure(
  page: import("@playwright/test").Page,
  html: string,
  probes: readonly (readonly [string, readonly string[]])[],
): Promise<Record<string, Record<string, string>>> {
  return page.evaluate(
    ([markup, wanted]) => {
      const host = document.createElement("div");
      host.id = "ui005-probe";
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

test.describe("the reader's shipped stylesheet", () => {
  test("gives the column reader the prototype's measure", async ({ page }) => {
    await page.goto("/");
    const styles = await measure(
      page,
      `<section class="col reading">
         <div class="col-head"><div class="chips"></div></div>
         <div class="col-list"></div>
         <div class="reader">
           <div class="reader-head"><span class="reader-id"></span><span class="save-chip"></span></div>
           <div class="reader-scroll"><div class="doc-body"><p>body</p></div></div>
         </div>
       </section>`,
      [
        [".col", ["width"]],
        [".col.reading", ["transition-property", "transition-duration"]],
        [".col-list", ["display"]],
        [".col-head .chips", ["display"]],
        [".reader", ["display"]],
        [".reader-scroll", ["overflow-y"]],
        [".doc-body", ["font-size", "line-height", "max-width"]],
      ],
    );

    /*
     * The default column width is still the prototype's, and it is still the
     * **stylesheet's** — but the reader-open widening stopped being a second
     * hard constant in UI-019. `.col.reading` no longer declares a width at all:
     * a column's base is its view document's (`extra.width`, SPEC.md §11) and
     * the widening is a ratio applied to *that* base, so `Column.tsx` computes
     * the result as an inline width. The prototype's 560 px is still exactly
     * what a default-width column lands on, and the test below proves it in the
     * running board rather than by reading a constant back out of the CSS.
     */
    expect(styles[".col"]?.["width"]).toBe("336px");

    /*
     * **And a column showing a document does not ease its width** (UI-146).
     *
     * This assertion used to read the other way — `.col.reading` transitioning
     * `width` over 0.25s, straight from the prototype. That eased open was free
     * while the reader was a fixed stack, and stopped being free when `.fm-form`
     * began rendering at all times (UI-093): the form's row count follows the
     * column's width by design (SHARED-061), so the widening reflowed the
     * document *while the document was on screen*. Measured per animation frame,
     * the body rose 97.7px and its closing paragraph travelled 267.7px after the
     * reader was already readable, and a right-click landing inside the window
     * made Chromium scroll the reader 103px under the pointer.
     * `column-open-geometry.spec.ts` holds the behavioural half of this.
     *
     * `border-color` stays — the `.col.flash` cue is a colour, and colour moves
     * nothing.
     */
    expect(styles[".col.reading"]?.["transition-property"]).toBe("border-color");

    // A column with no reader in it still eases, which is where the prototype's
    // 0.25s went: an arrow-key step at the edge, and a width another browser
    // wrote. Only the open case changed.
    const listColumn = await measure(page, `<section class="col"></section>`, [
      [".col", ["transition-property", "transition-duration"]],
    ]);
    expect(listColumn[".col"]?.["transition-property"]).toContain("width");
    expect(listColumn[".col"]?.["transition-duration"]).toContain("0.25s");
    // The column is a list or a reader, never both.
    expect(styles[".col-list"]?.["display"]).toBe("none");
    expect(styles[".col-head .chips"]?.["display"]).toBe("none");
    expect(styles[".reader"]?.["display"]).toBe("flex");
    // The reader scrolls, not the page.
    expect(styles[".reader-scroll"]?.["overflow-y"]).toBe("auto");
    expect(styles[".doc-body"]?.["font-size"]).toBe("15px");
    // 15px × 1.62.
    expect(styles[".doc-body"]?.["line-height"]).toBe("24.3px");
    expect(
      await measureCh(
        page,
        `<div class="reader-scroll"><div class="doc-body"><p>body</p></div></div>`,
        ".doc-body",
      ),
    ).toBe(62);
  });

  /**
   * The other half of the same guarantee, in the running board.
   *
   * UI-019 made the reader-open width a ratio over the column's own base rather
   * than a second hard constant, so the prototype's 560 px is no longer
   * readable out of the stylesheet — but it is still exactly what a column with
   * no chosen width lands on, and that is the promise `design/index.html` makes.
   * Asserting it here keeps the prototype measure pinned where it now actually
   * lives.
   */
  test("a column with no chosen width still opens to the prototype's 560px", async ({ page }) => {
    await stubCorpus(page, [
      {
        id: "doc_view_inbox",
        type: "view",
        title: "Inbox",
        path: "data/docs/views/inbox.md",
        pinned: true,
        order: 1,
        query: { folder: "inbox" },
      },
      { id: "doc_note", title: "Mortgage options", body: "Compare fixed against tracker." },
    ]);
    await page.goto("/");

    const column = page.locator('.col[data-col="doc_view_inbox"]');
    await expect(column).toHaveCSS("width", "336px");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(column.locator(".reader")).toBeVisible();
    await expect(column).toHaveCSS("width", "560px");
  });

  test("gives focus mode a full viewport and a wider measure", async ({ page }) => {
    await page.goto("/");
    const styles = await measure(
      page,
      `<div class="focus open">
         <div class="focus-scroll">
           <div class="focus-inner"><div class="doc-body"><p>body</p></div></div>
         </div>
       </div>`,
      [
        [".focus", ["position", "top", "right", "bottom", "left", "z-index", "display"]],
        [".focus-inner", ["max-width"]],
        [".focus .doc-body", ["max-width", "font-size", "line-height"]],
      ],
    );

    expect(styles[".focus"]?.["position"]).toBe("fixed");
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(styles[".focus"]?.[side]).toBe("0px");
    }
    // Below UI-009's overlay (40) and above everything on the board.
    expect(styles[".focus"]?.["z-index"]).toBe("35");
    expect(styles[".focus"]?.["display"]).toBe("flex");

    // 76ch outer, 66ch for the prose — the prototype's two measures. They are
    // set at different fonts, so each is resolved against its own `ch`.
    const shell = `<div class="focus open"><div class="focus-scroll">
        <div class="focus-inner"><div class="doc-body"><p>body</p></div></div>
      </div></div>`;
    expect(await measureCh(page, shell, ".focus-inner")).toBe(76);
    expect(await measureCh(page, shell, ".focus .doc-body")).toBe(66);
    expect(styles[".focus .doc-body"]?.["font-size"]).toBe("16.5px");
    // 16.5px × 1.7.
    expect(styles[".focus .doc-body"]?.["line-height"]).toBe("28.05px");
  });

  test("makes an unresolved ref visibly different from a live one", async ({ page }) => {
    await page.goto("/");
    const styles = await measure(
      page,
      `<div class="doc-body"><a class="ref" href="#x">live</a><span class="ref-broken">broken</span></div>`,
      [
        [".ref", ["color", "cursor", "border-bottom-style", "text-decoration-line"]],
        [".ref-broken", ["color", "cursor", "border-bottom-style", "text-decoration-line"]],
      ],
    );

    // SPEC.md §5: legitimate, and visibly so — a warning, not an error.
    expect(styles[".ref-broken"]?.["color"]).not.toBe(styles[".ref"]?.["color"]);
    expect(styles[".ref"]?.["cursor"]).toBe("pointer");
    expect(styles[".ref-broken"]?.["cursor"]).toBe("default");
    expect(styles[".ref-broken"]?.["border-bottom-style"]).toBe("dotted");
    expect(styles[".ref-broken"]?.["text-decoration-line"]).toBe("line-through");
  });

  test("covers the thread flash with the shell's one reduced-motion guard", async ({ page }) => {
    await page.goto("/");
    // Declared once, in `app/global.css`, so no future animated element can ship
    // without it — the rule this asserts is that the reader joined that block
    // rather than declaring a second one.
    const covered = await page.evaluate(() => {
      const rules: string[] = [];
      for (const sheet of [...document.styleSheets]) {
        let list: CSSRuleList;
        try {
          list = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of [...list]) {
          if (
            rule instanceof CSSMediaRule &&
            rule.conditionText.includes("prefers-reduced-motion")
          ) {
            rules.push(rule.cssText);
          }
        }
      }
      return rules;
    });
    expect(covered.join(" ")).toContain(".thread-card.flash");
    expect(covered.filter((rule) => rule.includes(".thread-card.flash"))).toHaveLength(1);
  });

  test("renders the shell with no uncaught error and no reader", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/");
    await expect(page.locator(".board")).toBeVisible();
    // No workspace server, so no column, so no reader — and the scaffold's copy
    // ("The document view — body, threads, focus mode — arrives with the
    // reader.") is gone from the tree for good.
    await expect(page.locator(".reader")).toHaveCount(0);
    expect(await page.content()).not.toContain("arrives with the reader");
    expect(uncaught).toEqual([]);
  });
});
