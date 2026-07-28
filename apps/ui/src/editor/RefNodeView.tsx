import { CorpusRequestError, useDoc } from "@corpus/kit";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { MutableRefObject, ReactElement } from "react";
import { optionalStringAttr, stringAttr } from "./markdown/attrs.js";
import { DocRef } from "./markdown/refNode.js";

/**
 * A `[[ref]]` as the editor draws it: the target's **current** title, resolved
 * at render time (SPEC.md §5).
 *
 * There are now two renderers for a reference — this one and the kit's
 * `RefLink`, which `MarkdownView` uses for turn bodies and previews. That is
 * deliberate and it is bounded: a remark plugin cannot run inside ProseMirror,
 * so the editor needs a node view. What the two must not do is disagree, so
 * they share the only thing worth sharing — the kit's `parseRefs` grammar
 * decides what a reference *is* (`parse.ts` runs the kit's own plugin), and the
 * treatments below match `RefLink`'s class for class: `.ref` when it resolves,
 * `.ref-broken` when the id does not exist (sprint-011 Adjudication 7).
 *
 * Resolution is a per-id `useDoc`, deduped by TanStack's key: a body citing the
 * same document eight times issues one request, and an id already in the
 * column's cache issues none.
 */

export type OpenRefCallback = ((docId: string) => void) | undefined;

export interface DocRefViewOptions {
  /** A ref box, never the callback: a new function must not remount every node view. */
  readonly openRef: MutableRefObject<OpenRefCallback>;
}

/** TipTap types an extension's options as `any`; narrowed here, once. */
function viewOptions(options: unknown): Partial<DocRefViewOptions> {
  if (typeof options !== "object" || options === null) return {};
  const openRef = (options as Record<string, unknown>)["openRef"];
  return typeof openRef === "object" && openRef !== null
    ? { openRef: openRef as MutableRefObject<OpenRefCallback> }
    : {};
}

function RefNodeView({ node, extension }: NodeViewProps): ReactElement {
  const id = stringAttr(node.attrs["id"]);
  const alias = optionalStringAttr(node.attrs["alias"]);
  const options = viewOptions(extension.options);

  const doc = useDoc(id);
  const title = doc.data?.frontmatter.title;
  const missing = doc.error instanceof CorpusRequestError && doc.error.status === 404;

  if (missing) {
    // SPEC.md §5: referencing a document that does not exist yet is legitimate,
    // so this is a visible warning and not an error — nothing logged, nothing
    // clickable, and the bracket form on disk is untouched.
    return (
      <NodeViewWrapper
        as="span"
        className="ref-broken"
        data-corpus-ref-broken={id}
        title={`${id} does not exist yet — this reference is unresolved.`}
      >
        {alias ?? id}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className="ref"
      data-corpus-ref={id}
      title={title === undefined ? id : `${title} (${id})`}
      // The editor is a contenteditable surface: without this the caret can
      // land inside the resolved title and typing would edit text that is not
      // in the file.
      contentEditable={false}
      onClick={(event: React.MouseEvent) => {
        event.preventDefault();
        options.openRef?.current?.(id);
      }}
    >
      {alias ?? title ?? id}
    </NodeViewWrapper>
  );
}

/** {@link DocRef}, plus the view. The schema is identical; only rendering differs. */
export function docRefWithView(openRef: MutableRefObject<OpenRefCallback>) {
  return DocRef.extend<DocRefViewOptions>({
    addOptions() {
      return { openRef };
    },
    addNodeView() {
      return ReactNodeViewRenderer(RefNodeView);
    },
  }).configure({ openRef });
}
