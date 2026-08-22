import { Extension } from "@tiptap/core";
import {
  DOMParser as PmDOMParser,
  type Node as PmModelNode,
  type ParseOptions,
  type Schema,
} from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { NODE } from "./markdown/schema.js";

/**
 * A soft line break inside a paragraph is a **space**, not a break (UI-072).
 *
 * The agent hard-wraps its prose at ~80 columns — measured on the live
 * workspace during UI-054, 10 of 11 agent turns — so most documents in a real
 * corpus carry a newline in the middle of most sentences. CommonMark says that
 * newline is a space, `MarkdownView` renders it as one, and a thread turn
 * written by the agent renders it as one (SPEC.md §10, SHARED-009 Amendment 7:
 * a person's typed newline breaks, an author's soft wrap does not). Only the
 * document editor disagreed, and it read visibly ragged.
 *
 * ## Why this is a decoration and not a parse
 *
 * The editor autosaves, so anything the parse changes the serializer writes back
 * to disk on the next keystroke. Turning soft newlines into spaces at parse time
 * would re-flow every agent-written paragraph the moment the user *opened* a
 * document — a whole-file diff, auto-committed, for a document they only read.
 * So the model keeps the author's bytes exactly as `parse.ts` produced them,
 * `serialize.ts` writes those bytes back unchanged, and the disagreement is
 * settled where the read surfaces settle it: at paint time.
 *
 * ## Why the class rather than a different `white-space` on the whole surface
 *
 * `white-space: pre-wrap` on `.ProseMirror` is prosemirror-view's own rule and
 * it is load-bearing for **spaces and tabs**: `checkCSS` in prosemirror-view
 * warns outright when the computed value is `normal`, `nowrap` or `pre-line`,
 * because a surface that collapses runs of spaces makes the DOM stop matching
 * the document — a typed space at the end of a line becomes invisible and
 * `readDOMChange` reads the wrong text back. It is **not** load-bearing for
 * newlines: outside a code block a ProseMirror text node does not normally
 * contain one at all, and here one does only because markdown put it there.
 *
 * CSS Text 4 spells the value that would preserve spaces while collapsing
 * breaks — `white-space-collapse: preserve-spaces` — and no shipping browser
 * implements it (measured in Chromium: the declaration is dropped and the
 * element falls back to `collapse`, which is the value ProseMirror rejects). So
 * the newline itself is wrapped in a one-character span that collapses, inside a
 * surface that does not. Spaces, tabs and indentation keep `pre-wrap`; the
 * newline becomes the space CommonMark says it is.
 *
 * The document is untouched, which is what keeps the DOM's text byte-identical
 * to the file — the property comment anchoring rests on (SPEC.md §6, and the
 * same property `turnBreaks.test.tsx` pins for threads).
 *
 * ## The other half: the newline has to survive being typed near
 *
 * Drawing it right is not enough, and the second half of this module is the
 * larger defect. ProseMirror reads a change back out of the DOM by re-parsing
 * the region around it (`parseBetween`), and it asks for
 * `preserveWhitespace: true` for any parent whose node spec is not
 * `whitespace: "pre"` — a paragraph. Under that option prosemirror-model does
 * **not** keep a newline: TipTap's `hardBreak` declares
 * `linebreakReplacement: true`, so every `\n` it re-reads is turned into a hard
 * break node, and without that declaration it would be turned into a space
 * instead. Either way the byte is gone.
 *
 * Measured in a real browser before this landed, on a paragraph the agent
 * hard-wrapped over three lines: typing one character rewrote the file's soft
 * wraps as backslash hard breaks —
 *
 *     Tomorrow is a\        ← was `Tomorrow is a`
 *     Wednesday, so the\    ← was `Wednesday, so the`
 *     office opens later.
 *
 * — which is a silent rewrite of lines the user never touched, and a change of
 * *meaning*: a soft wrap is a space and a hard break is a break, so the
 * paragraph then reads as broken lines on every read surface too. It was
 * invisible before only because the editor already drew every soft wrap as a
 * break; the moment it draws them as prose, one keystroke visibly shatters the
 * paragraph.
 *
 * So the editor is given a DOM parser that upgrades that `true` to `"full"` —
 * the option a code block already gets. It is the faithful inverse of how the
 * surface renders: under `white-space: pre-wrap` the DOM's text *is* the
 * document's text, so reading it back verbatim is the only reading that
 * round-trips. A real `<br>` still parses to a hard break through its own tag
 * rule, so a deliberate break is untouched, and only `parseBetween` is affected
 * — the clipboard goes through `parseSlice`, which this does not override.
 */

/** The span the newline is drawn in. `editor.css` gives it `white-space: normal`. */
export const SOFT_WRAP_CLASS = "md-soft-wrap";

export const SOFT_WRAP_NAME = "corpusSoftWrap";

const softWrapKey = new PluginKey<DecorationSet>(SOFT_WRAP_NAME);

/**
 * One decoration per soft newline in the document.
 *
 * **Code blocks are skipped**, and they are the whole reason this is a walk
 * rather than a stylesheet rule: a fence's newlines are its content, and the
 * `pre` they render in must keep drawing them. Everything else that holds a
 * literal newline in a text node got it from a wrapped line of markdown — a
 * paragraph, a heading, a list item, a blockquote, the text of a link, a code
 * *span* (where CommonMark also says the break is a space). `rawBlock` and
 * `rawInline` carry their source in an attribute rather than as text, so the
 * walk never sees it and `.md-raw`'s `white-space: pre` stands.
 */
export function softWrapDecorations(doc: PmModelNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === NODE.codeBlock) return false;
    const text = node.isText ? (node.text ?? "") : "";
    for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
      decorations.push(Decoration.inline(pos + at, pos + at + 1, { class: SOFT_WRAP_CLASS }));
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * A DOM parser that reads a newline back as a newline.
 *
 * Only `parse` is overridden, and only where the caller asked for
 * `preserveWhitespace: true`. `parseBetween` — reading a typed change out of
 * the DOM — is the sole caller of `parse` on the view's parser; the clipboard
 * calls `parseSlice`, which is left exactly as it was so that pasting a word
 * processor's indented markup still collapses.
 */
class NewlineFaithfulParser extends PmDOMParser {
  override parse(dom: Node, options: ParseOptions = {}): PmModelNode {
    if (options.preserveWhitespace !== true) return super.parse(dom, options);
    return super.parse(dom, { ...options, preserveWhitespace: "full" });
  }
}

function newlineFaithfulParser(schema: Schema): PmDOMParser {
  // The rules the schema's own parser would use, so every node and mark still
  // parses by its own `parseHTML` — this changes *whitespace*, nothing else.
  return new NewlineFaithfulParser(schema, PmDOMParser.fromSchema(schema).rules);
}

/**
 * The extension, view-only: it contributes no node and no mark, so the schema —
 * and therefore what a document serializes to — is exactly what it was.
 *
 * The decorations are rebuilt from the document on every change rather than
 * mapped through the transaction: a soft newline is a single character with no
 * identity worth preserving, and an edit that joins two wrapped lines has to
 * *remove* one, which mapping alone would not do.
 */
export const SoftWrap = Extension.create({
  name: SOFT_WRAP_NAME,

  addProseMirrorPlugins() {
    // Built from the live schema rather than from `corpusSchema()`: a parser
    // must create nodes of the *editor's* schema instance, and TipTap builds
    // its own from the extension list.
    const parser = newlineFaithfulParser(this.editor.schema);
    return [
      new Plugin<DecorationSet>({
        key: softWrapKey,
        state: {
          init: (_config, state) => softWrapDecorations(state.doc),
          apply: (tr, value) => (tr.docChanged ? softWrapDecorations(tr.doc) : value),
        },
        props: {
          decorations: (state) => softWrapKey.getState(state),
          domParser: parser,
        },
      }),
    ];
  },
});
