import { CorpusImage, IMAGE_CLASS } from "@corpus/kit";
import Image from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeView,
  ReactNodeViewRenderer,
  type NodeViewProps,
  type NodeViewRendererProps,
} from "@tiptap/react";
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

/**
 * Whether this event is the press that opens the full-screen viewer, and so
 * belongs to the picture rather than to ProseMirror (UI-202).
 *
 * **Why the editor must not see it.** ProseMirror answers a plain click on a
 * selectable node by putting a `NodeSelection` on it. On this node the same
 * click also opens the viewer, which takes focus away from the editor, and
 * closing it hands focus back to the picture (SPEC.md §10) — so the editor was
 * left holding a selection on the image that nobody asked for and nobody could
 * see under the overlay. The DOM selection held it too. The very next keystroke
 * then **replaced the image**: typing `Z` turned `[Before, <image>, After]`
 * into `[Before, Z, After]`, with or without a click elsewhere first (a click
 * only narrowed the window to the browser's `selectionchange` delay, ~15 ms).
 * A press that opens a picture is not a press that selects a node, so the
 * editor's selection stays exactly where the person left it.
 *
 * Only the gesture that opens the viewer is taken:
 *
 * - **The primary button.** A right-click is UI-036's context menu, and that
 *   reads the editor's selection.
 * - **Without `⇧`.** Shift-click extends a text selection, and `CorpusImage`
 *   deliberately does not open over the end of one.
 * - **On a viewable image.** `role="button"` is what `CorpusImage` puts on a
 *   picture it can open; a pending or broken one, or one rendered with no
 *   viewer mounted, is not a control and keeps the editor's default.
 */
export function opensTheViewer(event: Event): boolean {
  if (event.type !== "mousedown" || !(event instanceof MouseEvent)) return false;
  if (event.button !== 0 || event.shiftKey) return false;
  const target = event.target;
  return target instanceof Element && target.matches(`img.${IMAGE_CLASS}[role="button"]`);
}

/** The schema's image node, plus the view. Only rendering differs. */
export function imageWithView() {
  return Image.extend({
    addNodeView() {
      const render = ReactNodeViewRenderer(ImageNodeView);
      return (props: NodeViewRendererProps) => {
        const view = render(props);
        // TipTap's own `stopEvent` stays in charge of every other event — it
        // is what keeps a key pressed on the focused picture away from the
        // editor. A `stopEvent` *option* would replace it outright, so the
        // view is wrapped instead. The inert placeholder TipTap returns before
        // `<EditorContent>` has mounted is not a `ReactNodeView`, draws no
        // picture, and is left alone.
        if (view instanceof ReactNodeView) {
          const inherited = view.stopEvent.bind(view);
          view.stopEvent = (event: Event) => opensTheViewer(event) || inherited(event);
        }
        return view;
      };
    },
  }).configure(IMAGE_OPTIONS);
}
