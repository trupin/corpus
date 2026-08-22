import { expect, test } from "./coverage";
import { hexToRgb, token } from "./tokens";

/**
 * UI-010's global composer and keyboard scheme, in a real browser — the half
 * that is honest to assert here.
 *
 * **Why only that half.** `playwright.config.ts` starts one Vite and this suite
 * deliberately runs with **no** workspace server on `127.0.0.1:8765`
 * (`smoke.spec.ts` asserts the console strip reads exactly "server
 * unreachable", which is only true while that port is unbound). Ask writes a
 * thread, Capture writes a document plus a thread, `⇧←`/`⇧→` writes `order`, and
 * `e` writes `status` — every one of those has to be checked **on disk and in
 * `git log`**, not in the DOM. So the behavioural half is verified against a
 * real `corpus init` workspace, a real server and a real browser in the issue's
 * E2E Verification Log, exactly as `thread.spec.ts` and `board.spec.ts` already
 * document for the same reason.
 *
 * What is left is not nothing, and it is the part a unit test cannot reach: the
 * compose panel's and cheat sheet's **measured** geometry against
 * `design/index.html`, in the cascade the real bundle actually produces — the
 * place where `.compose-panel`'s 640px silently lost to `.search-panel`'s 760px
 * until the rule was made specific enough (found by exactly this measurement).
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
      host.id = "ui010-probe";
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
const LIGHT_INK_2 = hexToRgb(token(':root\\[data-theme="light"\\]', "--ink-2"));
const LIGHT_INK_3 = hexToRgb(token(':root\\[data-theme="light"\\]', "--ink-3"));
const LIGHT_SURFACE_2 = hexToRgb(token(':root\\[data-theme="light"\\]', "--surface-2"));
const LIGHT_BG = hexToRgb(token(':root\\[data-theme="light"\\]', "--bg"));

const COMPOSE_PANEL = `
  <div class="overlay open">
    <div class="search-panel compose-panel" data-dropzone="compose">
      <textarea data-composer="compose"></textarea>
      <div class="pending-atts"><span class="att-chip">a.png<button>✕</button></span></div>
      <div class="compose-actions">
        <button class="clip">📎</button>
        <span class="hint">@ agents · / skills · [[ refs · ↵ newline</span>
        <span class="spacer"></span>
        <button class="btn-capture">Capture ⇧⌘↵</button>
        <button class="btn-ask">Ask ⌘↵</button>
      </div>
    </div>
  </div>`;

const KBD_PANEL = `
  <div class="overlay open">
    <div class="search-panel kbd-panel">
      <h3>Keyboard</h3>
      <div class="kbd-grid">
        <div class="kbd-row"><span class="keys"><kbd>↑</kbd><kbd>↓</kbd></span>
          <span class="d">move rows (also j / k)</span></div>
        <div class="kbd-row"><span class="keys"><kbd>?</kbd></span>
          <span class="d">this cheat-sheet</span></div>
      </div>
    </div>
  </div>`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("corpus.theme", "light");
  });
  await page.goto("/");
  await expect(page.locator(".app")).toBeVisible();
});

test.describe("the compose panel", () => {
  test("is the prototype's 640px card, 12vh down, over the search scrim", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const box = await page.evaluate((markup) => {
      const host = document.createElement("div");
      host.innerHTML = markup;
      document.body.append(host);
      const panel = host.querySelector(".compose-panel") as HTMLElement;
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const answer = { width: rect.width, top: rect.top, marginTop: style.marginTop };
      host.remove();
      return answer;
    }, COMPOSE_PANEL);

    // `min(640px, 100vw - 48px)` at 1440px wide, and `12vh` of a 900px viewport.
    expect(box.width).toBe(640);
    expect(box.marginTop).toBe("108px");
    expect(box.top).toBe(108);
  });

  test("has the borderless serif textarea the prototype writes into", async ({ page }) => {
    const styles = await measure(page, COMPOSE_PANEL, [
      [
        ".compose-panel textarea",
        ["font-size", "line-height", "min-height", "padding", "resize", "border-style"],
      ],
    ]);
    const textarea = styles[".compose-panel textarea"] ?? {};
    expect(textarea["font-size"]).toBe("16px");
    // 16px × 1.55, as Chromium resolves it.
    expect(textarea["line-height"]).toBe("24.8px");
    expect(textarea["min-height"]).toBe("110px");
    expect(textarea["padding"]).toBe("16px 18px");
    expect(textarea["resize"]).toBe("vertical");
    expect(textarea["border-style"]).toBe("none");
  });

  test("bars the actions across a surface-2 foot under a hairline", async ({ page }) => {
    const styles = await measure(page, COMPOSE_PANEL, [
      [
        ".compose-actions",
        ["display", "align-items", "gap", "padding", "background-color", "border-top-width"],
      ],
      [".compose-actions .hint", ["font-size", "color"]],
    ]);
    const actions = styles[".compose-actions"] ?? {};
    expect(actions["display"]).toBe("flex");
    expect(actions["align-items"]).toBe("center");
    expect(actions["gap"]).toBe("10px");
    expect(actions["padding"]).toBe("10px 16px");
    expect(actions["background-color"]).toBe(LIGHT_SURFACE_2);
    expect(actions["border-top-width"]).toBe("1px");
    expect(styles[".compose-actions .hint"]?.["font-size"]).toBe("10.5px");
    expect(styles[".compose-actions .hint"]?.["color"]).toBe(LIGHT_INK_3);
  });

  test("makes Ask the accent-filled action and Capture the outlined one", async ({ page }) => {
    const styles = await measure(page, COMPOSE_PANEL, [
      [".btn-ask", ["background-color", "color", "border-radius", "padding", "font-weight"]],
      [".btn-capture", ["border-width", "border-style", "color", "border-radius", "padding"]],
    ]);
    const ask = styles[".btn-ask"] ?? {};
    expect(ask["background-color"]).toBe(LIGHT_ACCENT);
    expect(ask["color"]).toBe(LIGHT_BG);
    expect(ask["border-radius"]).toBe("8px");
    expect(ask["padding"]).toBe("6px 16px");
    expect(ask["font-weight"]).toBe("600");

    const capture = styles[".btn-capture"] ?? {};
    expect(capture["border-width"]).toBe("1px");
    expect(capture["border-style"]).toBe("solid");
    expect(capture["color"]).toBe(LIGHT_INK_2);
    expect(capture["border-radius"]).toBe("8px");
    expect(capture["padding"]).toBe("6px 16px");
  });

  test("insets the pending-attachment strip to the text's measure", async ({ page }) => {
    const styles = await measure(page, COMPOSE_PANEL, [
      [".compose-panel .pending-atts", ["padding", "display", "flex-wrap"]],
    ]);
    const strip = styles[".compose-panel .pending-atts"] ?? {};
    expect(strip["padding"]).toBe("0px 18px 8px");
    expect(strip["display"]).toBe("flex");
    expect(strip["flex-wrap"]).toBe("wrap");
  });

  /**
   * UI-070. The chip and the 📎 are no longer this app's CSS: they ship from
   * `@corpus/kit/composer.css` with `PendingAttachments` and `AttachButton`, so
   * every composer in the app inherits the look instead of approximating it.
   *
   * Asserted **here**, in the cascade the real bundle produces, because that is
   * the only place the move can be wrong: a stylesheet the kit exports but
   * `main.tsx` never imports type-checks, unit-tests green, and renders naked
   * chips. `.compose-panel .pending-atts` above and this together also pin the
   * specificity — the app's inset must still win over the kit's base rule.
   */
  test("draws the chip and the clip from the kit's composer stylesheet", async ({ page }) => {
    const styles = await measure(page, COMPOSE_PANEL, [
      [
        ".att-chip",
        [
          "display",
          "align-items",
          "gap",
          "background-color",
          "color",
          "border-radius",
          "font-size",
        ],
      ],
      [".clip", ["color", "font-size", "padding"]],
    ]);

    const chip = styles[".att-chip"] ?? {};
    // The chip declares `inline-flex`; it is a flex item of `.pending-atts`, and
    // a flex item's outer display is blockified, so the *computed* value is
    // `flex`. That it is a flex box at all is the assertion — an unstyled span
    // in the same place computes `block`, which is what a missing stylesheet
    // would have produced.
    expect(chip["display"]).toBe("flex");
    expect(chip["align-items"]).toBe("center");
    expect(chip["gap"]).toBe("6px");
    expect(chip["background-color"]).toBe(LIGHT_SURFACE_2);
    expect(chip["color"]).toBe(LIGHT_INK_2);
    expect(chip["border-radius"]).toBe("7px");
    expect(chip["font-size"]).toBe("11px");

    const clip = styles[".clip"] ?? {};
    expect(clip["color"]).toBe(LIGHT_INK_3);
    expect(clip["font-size"]).toBe("13px");
    expect(clip["padding"]).toBe("0px 4px");
  });

  /**
   * The rule that keeps a composer a composer: with nothing attached the strip
   * collapses entirely rather than reserving a row, which is what stops the
   * comment popover reflowing into a panel when it grew attachments (UI-111).
   */
  test("collapses the chip strip entirely while it is empty", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="overlay open"><div class="search-panel compose-panel">
         <div class="pending-atts"></div>
       </div></div>`,
      [[".pending-atts", ["display"]]],
    );
    expect(styles[".pending-atts"]?.["display"]).toBe("none");
  });
});

test.describe("the cheat sheet", () => {
  test("is the prototype's `.kbd-panel`: mono header over a two-column grid", async ({ page }) => {
    const styles = await measure(page, KBD_PANEL, [
      [".kbd-panel", ["padding"]],
      [".kbd-panel h3", ["font-size", "text-transform", "letter-spacing", "color"]],
      [".kbd-grid", ["display", "gap"]],
    ]);
    expect(styles[".kbd-panel"]?.["padding"]).toBe("20px 24px");
    const heading = styles[".kbd-panel h3"] ?? {};
    expect(heading["font-size"]).toBe("11px");
    expect(heading["text-transform"]).toBe("uppercase");
    expect(heading["letter-spacing"]).toBe("0.88px");
    expect(heading["color"]).toBe(LIGHT_INK_3);
    expect(styles[".kbd-grid"]?.["display"]).toBe("grid");
    expect(styles[".kbd-grid"]?.["gap"]).toBe("2px 30px");
  });

  test("gives every row a 92px key group and a dim description", async ({ page }) => {
    const styles = await measure(page, KBD_PANEL, [
      [".kbd-row", ["display", "align-items", "gap", "padding", "font-size"]],
      [".kbd-row .keys", ["display", "gap", "min-width", "flex-grow", "flex-shrink"]],
      [".kbd-row kbd", ["font-size", "border-width", "border-radius", "padding", "color"]],
      [".kbd-row .d", ["color"]],
    ]);
    const row = styles[".kbd-row"] ?? {};
    expect(row["display"]).toBe("flex");
    expect(row["align-items"]).toBe("center");
    expect(row["gap"]).toBe("10px");
    expect(row["padding"]).toBe("5px 0px");
    expect(row["font-size"]).toBe("12.5px");

    const keys = styles[".kbd-row .keys"] ?? {};
    expect(keys["min-width"]).toBe("92px");
    expect(keys["gap"]).toBe("4px");
    expect(keys["flex-grow"]).toBe("0");
    expect(keys["flex-shrink"]).toBe("0");

    const chip = styles[".kbd-row kbd"] ?? {};
    expect(chip["font-size"]).toBe("10.5px");
    // 1px all round with a 2px bottom, the prototype's "key cap".
    expect(chip["border-width"]).toBe("1px 1px 2px");
    expect(chip["border-radius"]).toBe("4px");
    expect(chip["padding"]).toBe("1px 6px");
    expect(chip["color"]).toBe(LIGHT_INK_2);
    expect(styles[".kbd-row .d"]?.["color"]).toBe(LIGHT_INK_2);
  });
});

test.describe("the keyboard's cues", () => {
  test("outlines the row under the cursor without moving it", async ({ page }) => {
    const styles = await measure(page, `<div class="row kbd">a row</div>`, [
      [".row.kbd", ["outline-width", "outline-style", "outline-color", "outline-offset"]],
    ]);
    const outline = styles[".row.kbd"] ?? {};
    expect(outline["outline-width"]).toBe("2px");
    expect(outline["outline-style"]).toBe("solid");
    expect(outline["outline-color"]).toBe(LIGHT_ACCENT);
    expect(outline["outline-offset"]).toBe("-2px");
  });

  test("rings the active column with the accent wash", async ({ page }) => {
    const styles = await measure(page, `<section class="col kactive"></section>`, [
      [".col.kactive", ["box-shadow"]],
    ]);
    expect(styles[".col.kactive"]?.["box-shadow"]).toContain("0px 0px 0px 2px");
  });
});

test.describe("the top bar's way in", () => {
  test("carries the ＋ Ask / Capture button with its `c` hint", async ({ page }) => {
    const button = page.getByRole("button", { name: /Ask \/ Capture/ });
    await expect(button).toBeVisible();
    await expect(button.locator("kbd")).toHaveText("c");
  });

  test("opens the composer from the button and from `c`, and closes it on escape", async ({
    page,
  }) => {
    const panel = page.getByRole("dialog", { name: "Ask or capture" });
    await expect(panel).toHaveCount(0);

    await page.getByRole("button", { name: /Ask \/ Capture/ }).click();
    await expect(panel).toBeVisible();
    // The scrim carries `.overlay.open` — the DOM contract `isOverlayOpen()` reads.
    await expect(page.locator(".overlay.open")).toHaveCount(1);
    await expect(page.locator(".compose-panel textarea")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    await page.locator(".topbar").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("c");
    await expect(panel).toBeVisible();
  });

  test("carries the prototype's two-line placeholder, character for character", async ({
    page,
  }) => {
    await page.keyboard.press("c");
    await expect(page.locator(".compose-panel textarea")).toHaveAttribute(
      "placeholder",
      "Ask the agent anything, or capture a thought…\n" +
        "@ routes to a subagent · / invokes a skill · [[ links a document · paste/drop files",
    );
  });

  test("orders the actions 📎 · address · hint · Capture · Ask", async ({ page }) => {
    await page.keyboard.press("c");
    await expect(page.locator(".compose-actions .btn-capture")).toHaveText("Capture ⇧⌘↵");
    await expect(page.locator(".compose-actions .btn-ask")).toHaveText("Ask ⌘↵");
    const order = await page
      .locator(".compose-actions > *")
      .evaluateAll((nodes: Element[]): string[] =>
        nodes.map((node) => node.className || node.tagName.toLowerCase()),
      );
    // The address line (UI-126) sits between the 📎 and the hint; the submits
    // keep the bar's tail, which is the key contract's order.
    expect(order).toEqual([
      "clip",
      "input",
      "composer-address",
      "hint",
      "spacer",
      "btn-capture",
      "btn-ask",
    ]);
  });

  test("disables both submits until there is something to send", async ({ page }) => {
    await page.keyboard.press("c");
    await expect(page.locator(".btn-ask")).toBeDisabled();
    await expect(page.locator(".btn-capture")).toBeDisabled();

    await page.locator(".compose-panel textarea").fill("something to ask");
    await expect(page.locator(".btn-ask")).toBeEnabled();
    await expect(page.locator(".btn-capture")).toBeEnabled();
  });

  /**
   * SPEC.md §10's composer key contract in a real browser, where `↵` is a real
   * keystroke into a real textarea rather than a synthetic event: it types a
   * newline, and the composer is still open afterwards because nothing was
   * submitted. `⇧↵` keeps doing the same thing it always did.
   */
  test("↵ and ⇧↵ both insert a newline in the textarea and submit nothing", async ({ page }) => {
    await page.keyboard.press("c");
    const textarea = page.locator(".compose-panel textarea");
    await textarea.fill("line one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("line two");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("line three");
    await expect(textarea).toHaveValue("line one\nline two\nline three");
    await expect(page.getByRole("dialog", { name: "Ask or capture" })).toBeVisible();
  });

  /**
   * The hint is the contract's own advertisement, and the buttons name the keys
   * that now submit them — `⌘↵` for the primary action, `⇧⌘↵` for the secondary.
   * What the chords *do* is asserted against a real workspace in the issue's E2E
   * log: this suite runs with no server, so Ask and Capture cannot land.
   */
  test("advertises the contract: ↵ newline in the hint, the chords on the buttons", async ({
    page,
  }) => {
    await page.keyboard.press("c");
    await expect(page.locator(".compose-actions .hint")).toHaveText(
      "@ agents · / skills · [[ refs · ↵ newline",
    );
    await expect(page.locator(".compose-actions .btn-ask")).toHaveText("Ask ⌘↵");
    await expect(page.locator(".compose-actions .btn-capture")).toHaveText("Capture ⇧⌘↵");
  });

  test("types `c` into the composer instead of reopening it", async ({ page }) => {
    await page.keyboard.press("c");
    await page.keyboard.type("cat");
    await expect(page.locator(".compose-panel textarea")).toHaveValue("cat");
    await expect(page.locator(".overlay.open")).toHaveCount(1);
  });
});

test.describe("the cheat sheet is generated from the registry", () => {
  /**
   * Thirteen since UI-018. Twelve come from §10's "Keyboard scheme (v1)" bullet;
   * the thirteenth is the same section's right-click bullet — "the menu key (or
   * ⇧F10) opens the same menu on the current keyboard highlight" — which is a
   * §10 binding wherever the sentence happens to sit, and therefore belongs in
   * the legend the registry generates. It is listed with the row bindings
   * because that is what it acts on.
   */
  test("`?` toggles it, and it lists SPEC.md §10's thirteen bindings in the prototype's order", async ({
    page,
  }) => {
    await page.locator(".topbar").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("?");
    const sheet = page.getByRole("dialog", { name: "Keyboard" });
    await expect(sheet).toBeVisible();
    await expect(page.locator(".overlay.open")).toHaveCount(1);

    expect(
      await page
        .locator(".kbd-row")
        .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset["shortcut"])),
    ).toEqual([
      "rows.move",
      "rows.open",
      "rows.openFullScreen",
      "menu.open",
      "layers.close",
      "columns.switch",
      "columns.move",
      "doc.focusMode",
      "doc.archive",
      "doc.reply",
      "compose.open",
      "search.open",
      "cheatSheet.toggle",
    ]);
    expect(
      await page
        .locator('.kbd-row[data-shortcut="rows.move"] kbd')
        .evaluateAll((chips) => chips.map((chip) => chip.textContent)),
    ).toEqual(["↑", "↓"]);

    await page.keyboard.press("?");
    await expect(sheet).toHaveCount(0);
  });

  test("refuses to stack: `?` over the composer is ignored, ⌘K replaces it", async ({ page }) => {
    await page.locator(".topbar").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("c");
    await expect(page.getByRole("dialog", { name: "Ask or capture" })).toBeVisible();

    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard" })).toHaveCount(0);
    await expect(page.locator(".overlay.open")).toHaveCount(1);

    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Ask or capture" })).toHaveCount(0);
    await expect(page.locator(".overlay.open")).toHaveCount(1);
  });

  test("suppresses every letter binding inside a writing surface, and keeps ⌘K", async ({
    page,
  }) => {
    await page.keyboard.press("Meta+k");
    const input = page.getByLabel("Search query");
    await expect(input).toBeFocused();

    await page.keyboard.type("cefrjk?");
    await expect(input).toHaveValue("cefrjk?");
    await expect(page.getByRole("dialog", { name: "Keyboard" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Ask or capture" })).toHaveCount(0);
    await expect(page.locator(".overlay.open")).toHaveCount(1);
  });
});
