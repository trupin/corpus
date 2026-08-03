/** @vitest-environment jsdom */
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { corpusExtensions } from "../editor/markdown/schema";
import { sliceMarkdown } from "../editor/clipboard";
import { captureCopy, type CopySelectionSource } from "./selectionCopy";

/**
 * Which flavors the right-click Copy captures, in each of the two renders a
 * document body has (UI-042).
 *
 * The editor half is asserted against the *editor's own* configured
 * serializers, not against a re-derivation of them: the point of routing
 * through `serializeForClipboard` is that the menu and ⌘C cannot disagree, and
 * a test that spelled the expected markdown by hand would go on passing after
 * they did.
 */

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

/** A live editor, mounted in the document so its DOM can contain a range. */
function mountEditor(content: string): Editor {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({
    element: host,
    extensions: corpusExtensions(),
    content,
    editorProps: {
      // What `DocEditor` configures. Without it `serializeForClipboard` gives
      // ProseMirror's default text, which is the thing UI-042 replaced.
      clipboardTextSerializer: (slice) => sliceMarkdown(slice, () => ({ title: null, href: null })),
    },
  });
  editors.push(editor);
  return editor;
}

/** A selection over `node`'s contents, shaped the way the copy path reads it. */
function selectionOver(node: Node): CopySelectionSource {
  const range = document.createRange();
  range.selectNodeContents(node);
  return { rangeCount: 1, getRangeAt: () => range };
}

function rendered(html: string): HTMLElement {
  const host = document.createElement("div");
  host.className = "doc-body";
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

describe("a selection inside the editor", () => {
  it("copies the editor's own two flavors — the markdown and its HTML", () => {
    const editor = mountEditor("<h2>Findings</h2><p>rates <strong>moved</strong></p>");
    editor.commands.selectAll();

    const copy = captureCopy(editor, "Findings rates moved", selectionOver(editor.view.dom));

    expect(copy.text).toBe("## Findings\n\nrates **moved**\n");
    expect(copy.html).toContain("<h2");
    expect(copy.html).toContain("<strong>moved</strong>");
  });

  it("is byte-identical to what ⌘C would put on the clipboard", () => {
    const editor = mountEditor("<p>rates <em>moved</em> this week</p>");
    editor.commands.setTextSelection({ from: 1, to: 12 });
    const direct = editor.view.serializeForClipboard(editor.state.selection.content());

    const copy = captureCopy(editor, "ignored", selectionOver(editor.view.dom));

    expect(copy.text).toBe(direct.text);
    expect(copy.html).toBe(direct.dom.innerHTML);
  });

  it("copies only the selected span, not the whole document", () => {
    const editor = mountEditor("<p>first para</p><p>second para</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });

    // A phrase, not a document: no trailing newline to break the line it lands in.
    expect(captureCopy(editor, "first", selectionOver(editor.view.dom)).text).toBe("first");
  });
});

describe("a selection outside the editor", () => {
  it("takes the rendered markup and keeps the captured text", () => {
    const host = rendered("<h2>Findings</h2><ul><li>first <strong>bold</strong> bullet</li></ul>");

    const copy = captureCopy(null, "Findings first bold bullet", selectionOver(host));

    expect(copy.text).toBe("Findings first bold bullet");
    expect(copy.html).toBe("<h2>Findings</h2><ul><li>first <strong>bold</strong> bullet</li></ul>");
  });

  it("leaves controls out of the copy", () => {
    // `@corpus/kit`'s `CodeFence` renders a copy button inside the fence.
    const host = rendered('<pre><button type="button">Copy</button><code>x = 1</code></pre>');

    expect(captureCopy(null, "x = 1", selectionOver(host)).html).toBe(
      "<pre><code>x = 1</code></pre>",
    );
  });

  it("joins every range of a multi-range selection", () => {
    const host = rendered("<p id=a>one</p><p id=b>two</p>");
    const ranges = ["#a", "#b"].map((id) => {
      const range = document.createRange();
      const node = host.querySelector(id);
      if (node === null) throw new Error("fixture did not render");
      range.selectNodeContents(node);
      return range;
    });

    const copy = captureCopy(null, "onetwo", {
      rangeCount: 2,
      getRangeAt: (index) => ranges[index] as Range,
    });

    expect(copy.html).toBe("onetwo");
  });

  it("offers no rich flavor when there is no selection at all", () => {
    expect(captureCopy(null, "words", null)).toEqual({ text: "words", html: null });
  });

  it("offers no rich flavor when the range holds nothing", () => {
    expect(captureCopy(null, "words", selectionOver(rendered("")))).toEqual({
      text: "words",
      html: null,
    });
  });
});

/**
 * A reader holds an open editor while a selection sits in a thread card beside
 * it. `editor.state.selection` still names whatever it last held, so asking the
 * editor without asking *where the selection is* would copy a stale span of the
 * document instead of the words under the pointer.
 */
describe("an editor that is not holding the selection", () => {
  it("copies the rendered surface, not the editor's last range", () => {
    const editor = mountEditor("<p>document prose</p>");
    editor.commands.setTextSelection({ from: 1, to: 9 });
    const host = rendered("<p>a thread turn</p>");

    const copy = captureCopy(editor, "a thread turn", selectionOver(host));

    expect(copy.text).toBe("a thread turn");
    expect(copy.html).toBe("<p>a thread turn</p>");
  });

  it("copies the rendered surface when the editor's selection is empty", () => {
    const editor = mountEditor("<p>document prose</p>");
    editor.commands.setTextSelection({ from: 3, to: 3 });

    const copy = captureCopy(editor, "document prose", selectionOver(editor.view.dom));

    expect(copy.text).toBe("document prose");
    expect(copy.html).toBe("<p>document prose</p>");
  });

  it("copies the rendered surface once the editor is gone", () => {
    const editor = mountEditor("<p>document prose</p>");
    editor.commands.selectAll();
    const dom = editor.view.dom;
    editor.destroy();

    expect(captureCopy(editor, "document prose", selectionOver(dom)).text).toBe("document prose");
  });
});

describe("the default selection source", () => {
  it("reads the live selection when none is handed over", () => {
    const host = rendered("<p>live words</p>");
    vi.spyOn(globalThis, "getSelection").mockReturnValue(
      selectionOver(host) as unknown as Selection,
    );

    expect(captureCopy(null, "live words").html).toBe("<p>live words</p>");
  });
});
