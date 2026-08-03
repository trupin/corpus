import { CorpusImage } from "@corpus/kit";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { ReactElement } from "react";
import { optionalStringAttr, stringAttr } from "./markdown/attrs.js";
import { IMAGE_OPTIONS } from "./markdown/schema.js";

/**
 * An image as the **editor** draws it (UI-049).
 *
 * There are now two renderers for a picture — this one and the kit's
 * `CorpusImage`, which `MarkdownView` uses for turn bodies and previews — for
 * exactly the reason there are two for a `[[ref]]`: a react-markdown component
 * override cannot run inside ProseMirror, so the editor needs a node view. And
 * as with the reference, the two do not get to disagree: this node view *is*
 * `CorpusImage`, wrapped in the span ProseMirror needs. A document body is
 * where `![](attachments/…)` was silently blank before this issue, and it is
 * the surface a user reads a note on — so it gets the authenticated fetch and
 * the full-screen viewer on the same terms as a turn.
 *
 * The `src` attribute is **not** touched. What the browser paints is a `blob:`
 * URL the kit owns; what the node holds, and what `serialize.ts` writes back to
 * the file, is the relative reference the author typed.
 */

function ImageNodeView({ node }: NodeViewProps): ReactElement {
  // `node.attrs` is ProseMirror's `Record<string, any>`; the two narrowing
  // helpers are the one place that escape is allowed.
  const src = stringAttr(node.attrs["src"]);
  const alt = optionalStringAttr(node.attrs["alt"]) ?? "";
  const title = optionalStringAttr(node.attrs["title"]);

  return (
    // The editor is a contenteditable surface: without this the caret can land
    // beside the image inside the wrapper and typing would edit a span that is
    // no part of the document.
    <NodeViewWrapper as="span" className="doc-image" contentEditable={false}>
      <CorpusImage src={src} alt={alt} {...(title === null ? {} : { title })} />
    </NodeViewWrapper>
  );
}

/** The schema's image node, plus the view. Only rendering differs. */
export function imageWithView() {
  return Image.extend({
    addNodeView() {
      return ReactNodeViewRenderer(ImageNodeView);
    },
  }).configure(IMAGE_OPTIONS);
}
