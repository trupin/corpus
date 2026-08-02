import { Node, mergeAttributes } from "@tiptap/core";
import { REF_ID_ATTRIBUTE, REF_ALIAS_ATTRIBUTE } from "@corpus/kit";
import { optionalStringAttr, stringAttr } from "./attrs.js";

/**
 * `[[doc_a1b2c3]]` and `[[doc_a1b2c3|as text]]` as an atomic inline node
 * (SPEC.md §5).
 *
 * **Schema only — no view, no title lookup.** The rendered text of a ref is the
 * target's *current* title, which is a query result; parsing and serialising a
 * document must work with no cache, no network and no React, so resolution
 * lives in `RefNodeView` and this node carries nothing but what the author
 * wrote. That split is also what makes the serialisation rule enforceable: the
 * bracket form is emitted **from the attributes**, never from the rendered
 * text, so a rename cannot rewrite the file (sprint-011 TEST-11).
 *
 * The `parseRefs` grammar in `@corpus/kit` stays the single source of what a
 * ref *is* (sprint-011 Adjudication 7). Nothing here re-implements the pattern;
 * `parse.ts` runs the kit's own remark plugin and this node only receives the
 * `{id, alias}` it produced.
 */

export interface DocRefAttributes {
  readonly id: string;
  /** The alias half of `[[id|alias]]`, or `null` for the bare form. */
  readonly alias: string | null;
}

export const DOC_REF_NAME = "docRef";

export const DocRef = Node.create({
  name: DOC_REF_NAME,
  group: "inline",
  inline: true,
  atom: true,
  // A ref is one indivisible thing: a caret cannot sit inside a document id,
  // and a selection that clipped one would serialise a broken bracket form.
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute(REF_ID_ATTRIBUTE) ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({
          [REF_ID_ATTRIBUTE]: stringAttr(attributes["id"]),
        }),
      },
      alias: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(REF_ALIAS_ATTRIBUTE),
        renderHTML: (attributes: Record<string, unknown>) => {
          const alias = optionalStringAttr(attributes["alias"]);
          return alias === null ? {} : { [REF_ALIAS_ATTRIBUTE]: alias };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: `a[${REF_ID_ATTRIBUTE}]` }, { tag: `span[${REF_ID_ATTRIBUTE}]` }];
  },

  /**
   * The no-view rendering: the id, or the alias when one was written.
   *
   * What a test without a query cache sees. The live editor replaces it with
   * `RefNodeView`, which shows the resolved title, and **the clipboard does not
   * use it at all** — `clipboard.ts` serializes a ref to its title, because the
   * id and this `href="#doc_x"` are the two things the §11 rider forbids
   * putting on the clipboard (a detached fragment resolves that hash against
   * whatever page is open, which is how it reached Google Docs as
   * `about:blank#doc_x`).
   */
  renderHTML({ HTMLAttributes, node }) {
    const id = stringAttr(node.attrs["id"]);
    const label = optionalStringAttr(node.attrs["alias"]) ?? id;
    return ["a", mergeAttributes({ class: "ref", href: `#${id}` }, HTMLAttributes), label];
  },

  /**
   * Plain-text rendering (copy to a plain-text target, and ProseMirror's own
   * `textBetween`): the bracket form, so text copied out of the editor and
   * pasted back parses into the same ref.
   */
  renderText({ node }) {
    return refSource({
      id: stringAttr(node.attrs["id"]),
      alias: optionalStringAttr(node.attrs["alias"]),
    });
  },
});

/** The bracket form of a ref, from its attributes. The only place it is spelled. */
export function refSource(attributes: DocRefAttributes): string {
  const alias = attributes.alias;
  return alias === null || alias === "" ? `[[${attributes.id}]]` : `[[${attributes.id}|${alias}]]`;
}
