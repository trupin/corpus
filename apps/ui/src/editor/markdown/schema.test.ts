// @vitest-environment jsdom
import { Editor, type Content, type JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse.js";
import { corpusExtensions, type PmNode } from "./schema.js";

/**
 * The same two crossings `DocEditor` makes: `PmNode` is the JSON shape the
 * parse and the serializer exchange, and TipTap spells the identical shape
 * `JSONContent`. Neither library can express that they are the same type.
 */
function asContent(node: PmNode): Content {
  return node as unknown as Content;
}

function asPmNode(content: JSONContent): PmNode {
  return content as unknown as PmNode;
}

/**
 * What the extension list must keep being, checked against a live editor
 * (UI-187).
 *
 * The upgrade from TipTap 2 to 3 was a security fix with no behavioural intent
 * — `GHSA-cp6q-959q-f8rh` has no 2.x backport — and it arrived carrying four
 * extensions StarterKit v2 did not ship. Two of them claimed mark names this
 * schema already owns, and one of them appended a node to every document. None
 * of that failed `roundtrip.test.ts` or `corpus.test.ts`, because those two run
 * the parse and the serializer and never build an editor: the serializer drops
 * a trailing empty paragraph, so a document model that had stopped matching the
 * file printed the same bytes.
 *
 * These assertions are the ones that would have caught it, and they exist for
 * the *next* bump rather than for this one. A vendor adding a default to a kit
 * is not something a version range can refuse.
 *
 * They assert against `Editor`, never against `corpusExtensions()`, because
 * `StarterKit` is a single extension named `starterKit` whose children appear
 * only once the manager has resolved it. A duplicate check over the list this
 * module returns would have seen one name and reported nothing.
 */
describe("the extension list a TipTap upgrade must not quietly widen", () => {
  const DOCUMENTS: readonly (readonly [string, string])[] = [
    ["a paragraph", "text\n"],
    ["a heading", "# Title\n"],
    ["a bullet list", "- one\n- two\n"],
    ["a task list", "- [ ] one\n"],
    ["a code block", "```ts\nconst a = 1;\n```\n"],
    ["a blockquote", "> quoted\n"],
    ["a thematic break", "---\n"],
    ["a table", "| a | b |\n| - | - |\n| 1 | 2 |\n"],
  ];

  /**
   * Built empty and then filled by `setContent`, which is what `DocEditor` does
   * when the server's copy arrives — and it is load-bearing here. A bundled
   * default that reacts to a transaction (`TrailingNode` does) never sees the
   * document a constructor's `content` option installs, so an editor built full
   * reports clean while the same editor one keystroke later does not.
   */
  function liveEditor(markdown: string): Editor {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: corpusExtensions(),
      content: "",
    });
    editor.commands.setContent(asContent(parseMarkdown(markdown)), { emitUpdate: false });
    return editor;
  }

  function topLevelTypes(node: PmNode): readonly string[] {
    return (node.content ?? []).map((child) => child.type);
  }

  it.each(DOCUMENTS)(
    "gives %s to the editor with no node the parse did not produce",
    (_case, markdown) => {
      const parsed = parseMarkdown(markdown);
      const editor = liveEditor(markdown);
      try {
        expect(topLevelTypes(asPmNode(editor.getJSON()))).toEqual(topLevelTypes(parsed));
      } finally {
        editor.destroy();
      }
    },
  );

  it("resolves every extension name exactly once", () => {
    const editor = liveEditor("text\n");
    try {
      const names = editor.extensionManager.extensions.map((extension) => extension.name);
      const duplicates = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
      expect(duplicates).toEqual([]);
    } finally {
      editor.destroy();
    }
  });

  it("renders a link with the `rel` `corpusExtensions` configures", () => {
    const editor = liveEditor("[text](https://example.com)\n");
    try {
      // Not a collision detector — measured on the duplicate, this repository's
      // `Link` still won. It pins the configuration itself: `noreferrer` and
      // `_blank` are what stop a document's link from carrying the board's URL
      // to the site it points at, and StarterKit v3's own default spells the
      // list differently.
      expect(editor.getHTML()).toContain('rel="noreferrer noopener"');
      expect(editor.getHTML()).toContain('target="_blank"');
    } finally {
      editor.destroy();
    }
  });
});
