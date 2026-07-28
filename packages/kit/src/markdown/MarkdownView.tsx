import { useMemo, useRef, type MutableRefObject, type ReactElement } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CorpusRequestError } from "../client/createCorpusClient.js";
import { useDoc } from "../query/useDoc.js";
import { REF_ALIAS_ATTRIBUTE, REF_ID_ATTRIBUTE, remarkCorpusRefs } from "./refs.js";

/**
 * The read surface for every markdown body in Corpus (SPEC.md §10 names
 * `MarkdownView` as part of the kit contract): `react-markdown` + `remark-gfm`,
 * with `[[ref]]` resolution.
 *
 * **No raw HTML path, by construction.** `rehype-raw` is deliberately absent, so
 * a body containing `<script>` or `<img onerror=…>` renders as inert markdown
 * text and never as elements. There is no sanitizer to configure and therefore
 * none to get wrong — the same reasoning `SnippetSchema` uses for search
 * highlights.
 *
 * **One renderer, every host.** The column reader, focus mode, thread turns and
 * plugin surfaces all render bodies through this component, which is what lets
 * UI-006 swap the read path for TipTap in exactly one place.
 */

export interface MarkdownViewProps {
  /** The markdown body, without its frontmatter block. */
  readonly markdown: string;
  /** Applied to the wrapper; the reader passes `doc-body`. */
  readonly className?: string;
  /**
   * Called with the target id when a resolved `[[ref]]` is activated. Omitted
   * makes refs render as resolved titles that are not navigable — correct for a
   * preview surface with nowhere to navigate to.
   */
  readonly onOpenRef?: ((docId: string) => void) | undefined;
}

type OpenRef = ((docId: string) => void) | undefined;

/** Hoisted for the same reason `components` is memoised: a new array is a new tree. */
const REMARK_PLUGINS = [remarkGfm, remarkCorpusRefs];

interface RefLinkProps {
  readonly id: string;
  readonly alias: string | null;
  /** A ref box, never the callback itself — see {@link MarkdownView}. */
  readonly onOpenRef: MutableRefObject<OpenRef>;
}

/**
 * One `[[ref]]`, resolved through the shared document cache.
 *
 * Resolution is a per-id `useDoc`, deduped by TanStack's key: a body citing the
 * same document eight times issues one request, and a document already open in
 * another reader issues none. There is no `ids=` filter on `GET /api/docs`, so
 * batching a body's refs into one request is not expressible today; this is
 * bounded by the distinct refs of the one document on screen, not by list
 * length.
 */
function RefLink({ id, alias, onOpenRef }: RefLinkProps): ReactElement {
  const doc = useDoc(id);
  const title = doc.data?.frontmatter.title;
  const missing = doc.error instanceof CorpusRequestError && doc.error.status === 404;

  if (missing) {
    // SPEC.md §5: referencing a not-yet-created document is legitimate, so this
    // is a visible warning and not an error — nothing is logged and nothing is
    // clickable, because there is nowhere to go.
    return (
      <span
        className="ref-broken"
        data-corpus-ref-broken={id}
        title={`${id} does not exist yet — this reference is unresolved.`}
      >
        {alias ?? id}
      </span>
    );
  }

  const label = alias ?? title ?? id;
  return (
    <a
      className="ref"
      href={`#${id}`}
      data-corpus-ref={id}
      title={title === undefined ? id : `${title} (${id})`}
      onClick={(event) => {
        event.preventDefault();
        onOpenRef.current?.(id);
      }}
    >
      {label}
    </a>
  );
}

export function MarkdownView({ markdown, className, onOpenRef }: MarkdownViewProps): ReactElement {
  /**
   * The navigation callback is held in a ref, and `components` is built **once**.
   *
   * `react-markdown` re-renders the whole tree whenever `components` changes
   * identity, and a host that passes an inline arrow — every host does — would
   * hand it a new object on every render of its parent. On a board, an unrelated
   * column re-render would then replace every `<a>` in the open document with a
   * fresh DOM node, and a click already in flight would land on a node whose
   * handler is gone. That was observed in a real browser, not theorised: the ref
   * is what makes the rendered body stable while the callback stays current.
   */
  const openRef = useRef<OpenRef>(onOpenRef);
  openRef.current = onOpenRef;

  const components = useMemo<Components>(
    () => ({
      a({ node, children, ...rest }) {
        // Read off the hast node rather than the JSX props: the id is put there
        // by `remarkCorpusRefs` as a literal attribute, and reading it back the
        // same way keeps this independent of how `data-*` names are cased on
        // their way into React.
        const refId = node?.properties[REF_ID_ATTRIBUTE];
        if (typeof refId === "string") {
          const rawAlias = node?.properties[REF_ALIAS_ATTRIBUTE];
          return (
            <RefLink
              id={refId}
              alias={typeof rawAlias === "string" ? rawAlias : null}
              onOpenRef={openRef}
            />
          );
        }
        return (
          <a {...rest} rel="noreferrer noopener" target="_blank">
            {children}
          </a>
        );
      },
    }),
    [],
  );

  return (
    <div className={className ?? "doc-body"}>
      <Markdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
}
