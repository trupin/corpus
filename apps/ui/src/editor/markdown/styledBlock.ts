import { Node, mergeAttributes } from "@tiptap/core";
import { numberAttr, optionalStringAttr } from "./attrs.js";

/**
 * SPEC.md §5's block styling: `::: {align="center"}` … `:::`.
 *
 * A **container**, not an atom. §5 calls this block styling, and what it styles
 * is ordinary blocks — a heading, a list, a table, another styled block. Making
 * it opaque would mean a person could centre a paragraph and then not be able to
 * edit it, which is the opposite of §10's "no edit mode".
 *
 * `defining: true` for the reason a blockquote is: lifting a paragraph out of a
 * styled block by backspacing at its start should remove the styling, not delete
 * the paragraph's own content into the block above.
 */

export const STYLED_BLOCK_NAME = "styledBlock";

export const StyledBlock = Node.create({
  name: STYLED_BLOCK_NAME,
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-corpus-align"),
        renderHTML: (attributes: Record<string, unknown>) => {
          const align = optionalStringAttr(attributes["align"]);
          return align === null ? {} : { "data-corpus-align": align };
        },
      },
      indent: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute("data-corpus-indent");
          return raw === null ? null : Number(raw);
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const indent = attributes["indent"];
          return typeof indent === "number" ? { "data-corpus-indent": String(indent) } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-corpus-align]" }, { tag: "div[data-corpus-indent]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const align = optionalStringAttr(node.attrs["align"]);
    const indent: unknown = node.attrs["indent"];
    const classes = ["md-style-block"];
    if (align !== null) classes.push(`md-style-align-${align}`);
    if (typeof indent === "number") {
      classes.push(`md-style-indent-${String(numberAttr(indent, 1))}`);
    }
    return ["div", mergeAttributes({ class: classes.join(" ") }, HTMLAttributes), 0];
  },
});
