import { Node, mergeAttributes } from "@tiptap/core";
import { stringAttr } from "./attrs.js";

/**
 * The two nodes that make the round trip **lossless** rather than merely
 * pretty.
 *
 * A markdown body may legitimately contain constructs this editor has no rich
 * representation for: an HTML block, a link reference definition, a footnote
 * definition or reference, an MDX-ish oddity an agent wrote by hand. A schema
 * that simply has no node for them does not "not support" them — it **deletes
 * them**, silently, the first time the user fixes a typo elsewhere in the file.
 * SPEC.md §5 makes the file on disk the record; an editor that quietly edits
 * parts of it the user never touched is the worst failure this component can
 * have.
 *
 * So an unknown construct is preserved as its own source text and emitted back
 * verbatim. It renders as inert, monospaced source — honest about the fact that
 * the editor does not understand it — and `git diff` after a save shows it
 * unchanged.
 */

export const RAW_BLOCK_NAME = "rawBlock";
export const RAW_INLINE_NAME = "rawInline";

/** A block-level construct kept as source: HTML, a definition, a footnote body. */
export const RawBlock = Node.create({
  name: RAW_BLOCK_NAME,
  group: "block",
  atom: true,
  selectable: true,
  // Not editable in place: the source is round-trip state, and letting a caret
  // into it would let a half-typed edit become a construct the parser reads
  // differently on the next save.
  isolating: true,

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-corpus-raw") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-corpus-raw": stringAttr(attributes["source"]),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "pre[data-corpus-raw]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "pre",
      mergeAttributes({ class: "md-raw" }, HTMLAttributes),
      ["code", {}, stringAttr(node.attrs["source"])],
    ];
  },

  renderText({ node }) {
    return stringAttr(node.attrs["source"]);
  },
});

/** An inline construct kept as source: inline HTML, a footnote reference. */
export const RawInline = Node.create({
  name: RAW_INLINE_NAME,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-corpus-raw") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-corpus-raw": stringAttr(attributes["text"]),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-corpus-raw]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes({ class: "md-raw-inline" }, HTMLAttributes),
      stringAttr(node.attrs["text"]),
    ];
  },

  renderText({ node }) {
    return stringAttr(node.attrs["text"]);
  },
});
