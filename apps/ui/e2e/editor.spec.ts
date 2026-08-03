import { expect, test } from "./coverage";

/**
 * UI-006's editor, in a real browser — the half that is honest to assert here.
 *
 * **Why only that half**, and it is the same split `reader.spec.ts` documents
 * for UI-005: `playwright.config.ts` starts one Vite whose proxy target is
 * fixed, and this suite deliberately runs with **no** workspace server on
 * `127.0.0.1:8765`, because `smoke.spec.ts` asserts the console strip reads
 * exactly "server unreachable" and that is only true while the port is unbound.
 * An editor needs a document, and a document needs a server.
 *
 * So the behavioural half — typing, the debounced `PUT`, the save chip driven
 * by the response, the user's edit lock, the agent lock going read-only and
 * back, `[[` autocomplete, the selection toolbar, focus mode, and the deferred
 * SSE update — is verified against a real `corpus init` workspace, a real
 * server and a real browser in the issue's E2E Verification Log, with the file
 * on disk and `git log` checked after every mutation.
 *
 * What is left is not nothing. Every rule below is a **stylesheet** contract
 * pinned by `design/index.html`'s "Editing (always-on, Docs-like)" block, and
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
      host.id = "ui006-probe";
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

test.describe("the editing surface", () => {
  test("a contenteditable body carries the accent caret and no outline", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="doc-editor" data-editable="true">
         <div class="ProseMirror doc-body" contenteditable="true"><p>text</p></div>
       </div>`,
      [[".ProseMirror", ["caret-color", "outline-style"]]],
    );
    const accent = await token(page, "--accent");
    // `design/index.html`: `[contenteditable] { outline: none; caret-color: var(--accent) }`
    expect(styles[".ProseMirror"]?.["outline-style"]).toBe("none");
    expect(styles[".ProseMirror"]?.["caret-color"]).not.toBe("");
    expect(accent).not.toBe("");
  });

  test("a locked body is visually flat — no caret, no text cursor", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="doc-editor" data-editable="false">
         <div class="ProseMirror doc-body" contenteditable="false"><p>text</p></div>
       </div>`,
      [[".ProseMirror", ["caret-color", "cursor"]]],
    );
    // SPEC.md §7: a locked document renders read-only, and nothing about it may
    // invite a keystroke the server would refuse.
    expect(styles[".ProseMirror"]?.["caret-color"]).toBe("rgba(0, 0, 0, 0)");
    expect(styles[".ProseMirror"]?.["cursor"]).toBe("default");
  });

  test("the editor's body is the same `.doc-body` the renderer uses", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="doc-editor">
         <div class="ProseMirror doc-body" contenteditable="true">
           <p>lead</p><h2>h</h2><p>p</p><ul><li>li</li></ul>
         </div>
       </div>`,
      [
        [".doc-body", ["font-size", "line-height", "font-family"]],
        [".doc-body h2", ["font-size", "margin-top", "margin-bottom"]],
        [".doc-body ul", ["margin-top", "padding-left"]],
        [".doc-body li", ["margin-top"]],
      ],
    );
    expect(styles[".doc-body"]?.["font-size"]).toBe("15px");
    expect(styles[".doc-body"]?.["line-height"]).toBe("24.3px");
    expect(styles[".doc-body"]?.["font-family"]).toContain("serif");
    expect(styles[".doc-body h2"]?.["font-size"]).toBe("17px");
    expect(styles[".doc-body h2"]?.["margin-top"]).toBe("22px");
    expect(styles[".doc-body h2"]?.["margin-bottom"]).toBe("6px");
    expect(styles[".doc-body ul"]?.["margin-top"]).toBe("8px");
    expect(styles[".doc-body ul"]?.["padding-left"]).toBe("22px");
    expect(styles[".doc-body li"]?.["margin-top"]).toBe("4px");
  });

  test("a construct the schema keeps verbatim renders as inert source", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="doc-editor"><pre class="md-raw"><code>&lt;div&gt;</code></pre></div>`,
      [[".md-raw", ["font-family", "white-space", "border-radius"]]],
    );
    expect(styles[".md-raw"]?.["font-family"]).toContain("mono");
    expect(styles[".md-raw"]?.["white-space"]).toBe("pre");
    expect(styles[".md-raw"]?.["border-radius"]).toBe("6px");
  });
});

test.describe("the save chip", () => {
  test("its three states take the three tokens they claim", async ({ page }) => {
    const styles = await measure(
      page,
      `<span class="save-chip">idle</span>
       <span class="save-chip saving">saving…</span>
       <span class="save-chip saved">committed · git ✓</span>
       <span class="save-chip failed">save failed</span>`,
      [
        [".save-chip", ["font-family", "font-size", "white-space"]],
        [".save-chip.saving", ["color"]],
        [".save-chip.saved", ["color"]],
        [".save-chip.failed", ["color"]],
      ],
    );
    expect(styles[".save-chip"]?.["font-family"]).toContain("mono");
    expect(styles[".save-chip"]?.["font-size"]).toBe("10.5px");
    expect(styles[".save-chip"]?.["white-space"]).toBe("nowrap");
    // `.saving` → `--sepia-ink`, `.saved` → `--good` (`design/index.html`), and
    // the failure state — which the prototype has no equivalent for, because
    // its autosave never fails — takes `--signal`.
    expect(styles[".save-chip.saving"]?.["color"]).toBe("rgb(122, 98, 56)");
    expect(styles[".save-chip.saved"]?.["color"]).toBe("rgb(78, 122, 70)");
    expect(styles[".save-chip.failed"]?.["color"]).toBe("rgb(196, 85, 46)");
  });
});

test.describe("the selection toolbar", () => {
  test("it is the prototype's pill, hidden until open", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="sel-toolbar"><button>B</button></div>
       <div class="sel-toolbar open" id="open">
         <button data-fmt="bold"><b>B</b></button>
         <button data-fmt="italic"><i>I</i></button>
         <span class="divider"></span>
         <button class="comment-btn">💬 Comment</button>
       </div>`,
      [
        [".sel-toolbar", ["display"]],
        [
          "#open",
          ["display", "position", "border-radius", "padding", "z-index", "background-color"],
        ],
        ["#open .comment-btn", ["font-weight", "color"]],
        ["#open .divider", ["width"]],
      ],
    );
    expect(styles[".sel-toolbar"]?.["display"]).toBe("none");
    expect(styles["#open"]?.["display"]).toBe("flex");
    expect(styles["#open"]?.["position"]).toBe("fixed");
    expect(styles["#open"]?.["border-radius"]).toBe("9px");
    expect(styles["#open"]?.["padding"]).toBe("4px");
    expect(styles["#open"]?.["z-index"]).toBe("50");
    // 💬 Comment is the act the surface exists for, and the prototype weights it.
    expect(styles["#open .comment-btn"]?.["font-weight"]).toBe("600");
    expect(styles["#open .divider"]?.["width"]).toBe("1px");
  });
});

test.describe("the `[[` menu", () => {
  test("it is the prototype's `.ac-menu`, scrolling and fixed", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="ac-menu open" id="menu">
         <button class="ac-item active"><span class="k">Rates</span><span class="d">note</span></button>
         <button class="ac-item"><span class="k">Mortgage options</span><span class="d">note</span></button>
       </div>`,
      [
        [
          "#menu",
          [
            "position",
            "border-radius",
            "padding",
            "min-width",
            "max-height",
            "overflow-y",
            "z-index",
          ],
        ],
        ["#menu .ac-item", ["border-radius", "font-size"]],
        ["#menu .ac-item .k", ["font-family"]],
        ["#menu .ac-item .d", ["font-size"]],
      ],
    );
    expect(styles["#menu"]?.["position"]).toBe("fixed");
    expect(styles["#menu"]?.["border-radius"]).toBe("9px");
    expect(styles["#menu"]?.["padding"]).toBe("4px");
    expect(styles["#menu"]?.["min-width"]).toBe("250px");
    expect(styles["#menu"]?.["max-height"]).toBe("200px");
    expect(styles["#menu"]?.["overflow-y"]).toBe("auto");
    expect(styles["#menu"]?.["z-index"]).toBe("60");
    expect(styles["#menu .ac-item"]?.["border-radius"]).toBe("6px");
    expect(styles["#menu .ac-item"]?.["font-size"]).toBe("12.5px");
    expect(styles["#menu .ac-item .k"]?.["font-family"]).toContain("mono");
    expect(styles["#menu .ac-item .d"]?.["font-size"]).toBe("11px");
  });

  test("the highlighted row is visibly the highlighted row", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="ac-menu open">
         <button class="ac-item" id="off">a</button>
         <button class="ac-item active" id="on">b</button>
       </div>`,
      [
        ["#off", ["background-color"]],
        ["#on", ["background-color"]],
      ],
    );
    expect(styles["#on"]?.["background-color"]).not.toBe(styles["#off"]?.["background-color"]);
  });
});

test.describe("references", () => {
  test("a resolved ref and a broken one are told apart at a glance", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="doc-editor doc-body">
         <span class="ref" id="ok">Rates</span>
         <span class="ref-broken" id="bad">doc_deadbeef</span>
       </div>`,
      [
        ["#ok", ["color", "border-bottom-width", "cursor"]],
        ["#bad", ["color", "text-decoration-line", "cursor"]],
      ],
    );
    expect(styles["#ok"]?.["border-bottom-width"]).toBe("1px");
    expect(styles["#ok"]?.["cursor"]).toBe("pointer");
    // SPEC.md §5: an unresolved reference is a visible warning and not a link —
    // nothing to click, because there is nowhere to go.
    expect(styles["#bad"]?.["text-decoration-line"]).toContain("line-through");
    expect(styles["#bad"]?.["cursor"]).toBe("default");
    expect(styles["#bad"]?.["color"]).not.toBe(styles["#ok"]?.["color"]);
  });
});

test.describe("focus mode's measures", () => {
  test("the same editor renders at the larger reading measure", async ({ page }) => {
    const styles = await measure(
      page,
      `<div class="focus">
         <div class="doc-editor">
           <div class="ProseMirror doc-body" contenteditable="true"><p>p</p></div>
         </div>
       </div>`,
      [[".doc-body", ["font-size", "line-height"]]],
    );
    // 16.5px / 1.7 in focus versus 15px / 1.62 in a column — one component, two
    // measures, which is what "the same editor" has to mean.
    expect(styles[".doc-body"]?.["font-size"]).toBe("16.5px");
    expect(styles[".doc-body"]?.["line-height"]).toBe("28.05px");
  });
});
