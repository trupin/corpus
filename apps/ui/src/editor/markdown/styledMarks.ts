import { Mark, mergeAttributes } from "@tiptap/core";
import { optionalStringAttr } from "./attrs.js";

/**
 * SPEC.md §5's three inline styling forms, as editor marks.
 *
 * They are **marks** rather than nodes because that is what they are in the
 * file: a range of a paragraph, composing with emphasis and with each other,
 * carrying no content of its own. Making one a node would put a boundary in the
 * document that markdown does not have, and a caret typing at its edge would
 * have to choose a side.
 *
 * Their spelling — `<u>x</u>`, `==x==`, `[x]{color="accent"}` — is the grammar's,
 * in `@corpus/contract`. Nothing here restates it: `parse.ts` maps the nodes the
 * kit's plugin produced, and `serialize.ts` prints the delimiters the kit names.
 */

export const UNDERLINE_MARK_NAME = "underline";
export const HIGHLIGHT_MARK_NAME = "highlight";
export const STYLE_SPAN_MARK_NAME = "styleSpan";

/** `<u>x</u>` — §5's one qualified tag, and never a raw-HTML path. */
export const UnderlineMark = Mark.create({
  name: UNDERLINE_MARK_NAME,
  parseHTML() {
    return [{ tag: "u" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["u", mergeAttributes(HTMLAttributes), 0];
  },
});

/**
 * `==x==` — a highlight with no role named.
 *
 * A coloured highlight is a {@link StyleSpanMark} carrying `highlight="…"`; this
 * is the bare form, and it renders with the default role so that a highlight
 * somebody typed by hand is visible without their having chosen a colour.
 */
export const HighlightMark = Mark.create({
  name: HIGHLIGHT_MARK_NAME,
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes({ class: "md-style md-style-highlight" }, HTMLAttributes), 0];
  },
});

/**
 * `[x]{color="accent"}` — the attribute span, carrying §5's named colour roles.
 *
 * Both attributes are nullable and at least one is set: a span with neither is
 * not something the file can say, so the serializer drops it rather than
 * printing an empty attribute list.
 */
export const StyleSpanMark = Mark.create({
  name: STYLE_SPAN_MARK_NAME,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-corpus-color"),
        renderHTML: (attributes: Record<string, unknown>) => {
          const color = optionalStringAttr(attributes["color"]);
          return color === null ? {} : { "data-corpus-color": color };
        },
      },
      highlight: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-corpus-highlight"),
        renderHTML: (attributes: Record<string, unknown>) => {
          const highlight = optionalStringAttr(attributes["highlight"]);
          return highlight === null ? {} : { "data-corpus-highlight": highlight };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-corpus-color]" }, { tag: "span[data-corpus-highlight]" }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const color = optionalStringAttr(mark.attrs["color"]);
    const highlight = optionalStringAttr(mark.attrs["highlight"]);
    const classes = ["md-style", "md-style-span"];
    if (color !== null) classes.push(`md-style-color-${color}`);
    if (highlight !== null) classes.push(`md-style-highlight-${highlight}`);
    return ["span", mergeAttributes({ class: classes.join(" ") }, HTMLAttributes), 0];
  },
});
