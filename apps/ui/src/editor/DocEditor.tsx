import type { Doc } from "@corpus/contract";
import { getSchema } from "@tiptap/core";
import { Node as PmModelNode, Slice } from "@tiptap/pm/model";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { docKey as docQueryKey } from "@corpus/kit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ChangelogClip } from "./changelogClip.js";
import { cleanPastedHtml, clipboardSerializer, sliceMarkdown } from "./clipboard.js";
import { imageWithView } from "./ImageNodeView.js";
import { refResolver } from "./refResolver.js";
import { RefAutocomplete } from "./RefAutocomplete.js";
import { docRefWithView, type OpenRefCallback } from "./RefNodeView.js";
import { SelectionToolbar } from "./SelectionToolbar.js";
import { useIsEditing } from "./editingRegistry.js";
import { DOC_REF_NAME } from "./markdown/refNode.js";
import { looksLikeMarkdown, parseMarkdown } from "./markdown/parse.js";
import { corpusExtensions, NODE as NODE_NAMES } from "./markdown/schema.js";
import { serializeDoc } from "./markdown/serialize.js";
import { editorBody } from "./editorBody.js";
import type { PmNode } from "./markdown/schema.js";
import { createRefSuggestion, type RefSuggestionState } from "./refSuggestion.js";
import { SoftWrap } from "./softWrap.js";
import { useSaveStatusPublisher } from "./SaveChip.js";
import { buildSelection, type EditorSelection } from "./selection.js";
import { useEditSurface } from "./editSessionFlush.js";
import { useAutosave, type AnchorReport } from "./useAutosave.js";
import "./editor.css";

/**
 * The document body, always editable (SPEC.md §10).
 *
 * There is no edit mode and no button: the body *is* the editor, you click
 * where you want to write and you write. Everything that used to be a mode is
 * now a consequence — the caret is `var(--accent)` because the surface is
 * editable.
 *
 * **And there is no other state.** §10: *the board is never read-only.* A
 * document the agent is writing is the same surface as any other; what protects
 * the two writers from each other is the key each of them presents (§7), not a
 * mode this component enters. The read-only branch, the banner it raised and the
 * `editable: false` toggle underneath it are gone — the surface has one state,
 * and it is editable.
 *
 * **The title is not here.** `FrontmatterForm` owns it, has owned it since
 * UI-005, and a second editable title would be two debounces racing on one
 * field (sprint-011 Adjudication 8). This component is body-only.
 */

/**
 * The two types whose body is **not** markdown prose, and therefore never the
 * editor's.
 *
 * A `thread` renders as its conversation — SPEC.md §6's "the conversation is
 * the document" — and a `view` is a saved query whose content is its
 * frontmatter, not its prose. Everything else is a markdown body, and §10 says
 * a markdown body is editable.
 */
const NON_EDITABLE_TYPES = new Set(["thread", "view"]);

/**
 * The two documents — this repo's and ProseMirror's — describe the same JSON
 * with different optionality stances (`exactOptionalPropertyTypes` is on
 * repo-wide; TipTap's `JSONContent` is not written for it). The values are
 * identical; only the spellings of "optional" differ.
 */
function asContent(node: PmNode): JSONContent {
  return node as unknown as JSONContent;
}

function asPmNode(content: JSONContent): PmNode {
  return content as unknown as PmNode;
}

/**
 * Whether the core would put the editor on this document type (UI-014).
 *
 * **Every markdown body, not only the core's.** This used to gate on
 * `CORE_DOC_TYPES`, which made a document typed for something the core does not
 * define render through the static `MarkdownView`: a body a person could read
 * and not correct, in a product whose §10 principle is that there is no edit
 * mode. sprint-011 adjudicated "the editor owns doc bodies always".
 *
 * **This is the whole of SPEC.md §12's M6 in one predicate.** `type` is an open
 * string on the wire (§5), a workspace holds whatever its owner and its agent
 * have written, and a document this build has never heard of must still open,
 * render its markdown with working checkboxes, be searchable and be commentable.
 * Every one of those follows from returning `true` here.
 *
 * **There is one gate, and it is this one.** Nothing claims a type ahead of the
 * editor, so `DocView` asks this predicate and renders — no second gate to keep
 * in step with it, and therefore no pair that can disagree about what "the core
 * does not know this type" means.
 */
export function editorHandlesType(type: string): boolean {
  return !NON_EDITABLE_TYPES.has(type);
}

export interface DocEditorProps {
  readonly docId: string;
  /** The body as the server holds it. */
  readonly body: string;
  /**
   * SPEC.md §7's key for the version {@link body} was read at — presented by
   * every autosave, and refreshed by every one that lands.
   *
   * Not derived from `body` here, and it must never be: a key is evidence that
   * this editor *read* a version, and one computed from the text about to be
   * sent would be evidence of nothing.
   */
  readonly documentKey: string;
  /** A resolved `[[ref]]` was activated. */
  readonly onOpenRef?: ((docId: string) => void) | undefined;
  /**
   * 💬 Comment. A stub until UI-007 wires threads to it; the payload's shape is
   * the contract between the two issues (see `selection.ts`).
   */
  readonly onComment?: ((selection: EditorSelection) => void) | undefined;
  /** Every save's anchor reconciliation report (SPEC.md §6). UI-007 consumes it. */
  readonly onAnchors?: ((report: AnchorReport) => void) | undefined;
  /**
   * The live editor instance, published on creation and on teardown.
   *
   * UI-007's highlights are ProseMirror **decorations** — SPEC.md §6 keeps the
   * body clean, so an anchor is drawn over the document rather than written
   * into it — and a decoration plugin needs the instance. Exposing it here is
   * that seam: the anchor layer registers against this editor rather than
   * mounting a second one.
   */
  readonly onEditor?: ((editor: Editor | null) => void) | undefined;
}

export function DocEditor({
  docId,
  body,
  documentKey,
  onOpenRef,
  onComment,
  onAnchors,
  onEditor,
}: DocEditorProps): ReactElement {
  /**
   * The body as this component understands it.
   *
   * Canonical, not raw: the file on disk may be in any of the shapes markdown
   * allows, and comparing the server's copy against the editor's serialisation
   * only means something once both have been through the same normalisation.
   * Without it, a document written with `*` bullets would look permanently
   * "changed" and autosave would fire on open.
   *
   * Through {@link editorBody} rather than inline, because the anchor layer has
   * to trace **this** text to make sense of the server's offsets, and the two
   * must stay one expression rather than two that happen to match (UI-099).
   */
  const canonical = useMemo(() => editorBody(body), [body]);

  const openRef = useRef<OpenRefCallback>(onOpenRef);
  openRef.current = onOpenRef;

  const [suggestion, setSuggestion] = useState<RefSuggestionState | null>(null);
  const suggestionKeys = useRef<((event: KeyboardEvent) => boolean) | null>(null);

  const queryClient = useQueryClient();
  /**
   * Publishes an authoritative document — a save's response, or the one a `409`
   * refused against — where a refetch would have put it (SPEC.md §7).
   *
   * This is what makes a conflict reach the editor as an **external change**
   * rather than through a mechanism of its own: `useDoc` reads this exact cache
   * entry, so the refusal's document travels the same path an agent's write
   * travels over SSE, and the rule below — which defers an incoming body while
   * the person is mid-sentence — governs it unchanged.
   */
  const publishServerDoc = useCallback(
    (doc: Doc): void => {
      queryClient.setQueryData(docQueryKey(docId), doc);
    },
    [docId, queryClient],
  );

  const autosave = useAutosave({
    docId,
    savedBody: canonical,
    savedKey: documentKey,
    onAnchors,
    onServerDoc: publishServerDoc,
  });
  /*
   * SPEC.md §4's close path. This component *is* the editing surface, and its
   * teardown — a closed reader, a navigation onto another document (the reader
   * keys it by id, so that is a remount) — is what ends the sitting. Counted
   * rather than flagged: focus mode over a column showing the same document is
   * two of these, and closing one of them has ended nothing.
   */
  useEditSurface(docId);
  const publishStatus = useSaveStatusPublisher();
  const editing = useIsEditing(docId);

  const change = useRef(autosave.change);
  change.current = autosave.change;

  /**
   * Built once. The extension list is the schema, and rebuilding it would
   * rebuild the ProseMirror schema — which ProseMirror treats as a different
   * document, losing the caret and every decoration on it.
   */
  const extensions = useMemo(
    () => [
      // Two nodes are swapped for view-carrying twins: the reference, whose
      // title is resolved at render time, and the image, whose bytes come
      // through the authenticated attachment path (UI-049). Both are the same
      // schema — only rendering differs — which is what keeps a document parsed
      // outside the browser and one typed in it the same document.
      ...corpusExtensions().filter(
        (extension) => extension.name !== DOC_REF_NAME && extension.name !== NODE_NAMES.image,
      ),
      docRefWithView(openRef),
      imageWithView(),
      createRefSuggestion({ onStateChange: setSuggestion, keyHandler: suggestionKeys }),
      // View-only, like the suggestion above it: it draws the document the
      // markdown says it is (UI-072) and contributes nothing to the schema, so
      // `corpusExtensions()` — which parsing and serialising share — stays the
      // list of what a *file* can contain.
      SoftWrap,
      // View-only for the same reason (UI-089): a changelog past §10's
      // threshold is *drawn* clipped, and the file keeps every entry.
      ChangelogClip,
    ],
    [],
  );

  /**
   * The clipboard's two flavors (SPEC.md §10 clipboard rider), built once
   * beside the schema they serialize.
   *
   * The resolver is read through a box for the same reason `openRef` is: it
   * closes over the query cache, and rebuilding either serializer would rebuild
   * the schema underneath the live document.
   */
  const resolveRef = useRef(refResolver(queryClient));
  resolveRef.current = refResolver(queryClient);
  const clipboard = useMemo(
    () => ({
      html: clipboardSerializer(getSchema(extensions), (id) => resolveRef.current(id)),
      text: (slice: Slice) => sliceMarkdown(slice, (id) => resolveRef.current(id)),
    }),
    [extensions],
  );

  const editor = useEditor(
    {
      extensions,
      content: asContent(parseMarkdown(canonical)),
      editorProps: {
        // Rich text out (`text/html`) and the document's own markdown out
        // (`text/plain`), so an external editor gets structure and a plain-text
        // target gets source rather than ProseMirror's `textBetween` dump.
        clipboardSerializer: clipboard.html,
        clipboardTextSerializer: clipboard.text,
        // Rich text in: the schema does the conversion, this only removes what
        // a word processor adds that would otherwise reach the file.
        transformPastedHTML: (html: string) => cleanPastedHtml(html),
        attributes: {
          class: "doc-body",
          "aria-label": "Document body",
        },
        /**
         * Escape leaves the writing surface.
         *
         * The escape chain (`useEscapeStack`) deliberately ignores keys typed
         * inside a contenteditable — otherwise `⌫` would close the reader
         * instead of deleting a character. Correct for `⌫`, and it means that
         * once the body became editable, Escape with the caret in it did
         * nothing at all: focus mode's own hint says "esc closes" and it had
         * stopped closing.
         *
         * So the first Escape blurs, and the second reaches the chain and
         * closes the layer. Leaving the
         * text before leaving the document is what a writing surface should do
         * anyway; a single press that did both would have to teach the chain
         * about text surfaces, and that is UI-010's keyboard scheme to design,
         * not this component's to pre-empt.
         */
        handleKeyDown(view, event) {
          if (event.key !== "Escape") return false;
          // The `[[` menu answers Escape first — it is the topmost thing open,
          // and dismissing it must not also throw the caret out of the
          // paragraph the user is in the middle of writing. Its handler lives
          // on a ProseMirror plugin, which runs *after* these direct props, so
          // declining here is what lets it through.
          if (suggestionKeys.current !== null) return false;
          view.dom.blur();
          return true;
        },
        /**
         * A plain-text paste of markdown becomes markdown.
         *
         * Three cases, and only the first is handled here. **Rich HTML**
         * (`text/html` present) is declined so ProseMirror's own clipboard
         * parser runs it through the schema's `parseHTML` — which is what
         * normalises a paste out of a browser or a word processor into nodes
         * this schema can serialise, with no `<span>` surviving to disk.
         * **Inside a code block** it is declined too: a fence's content is
         * literal by definition, and parsing a paste there would turn pasted
         * source into headings. Everything else is parsed with the same parser
         * the document was loaded with.
         */
        handlePaste(view, event) {
          const clipboard = event.clipboardData;
          if (clipboard === null) return false;
          if (view.state.selection.$from.parent.type.name === NODE_NAMES.codeBlock) return false;
          if (clipboard.getData("text/html") !== "") return false;
          const text = clipboard.getData("text/plain");
          if (text === "" || !looksLikeMarkdown(text)) return false;

          const parsed = PmModelNode.fromJSON(view.state.schema, asContent(parseMarkdown(text)));
          const blocks = parsed.content;
          // A single paragraph pastes as *inline* content, so pasting
          // `**bold**` mid-sentence bolds a word rather than splitting the
          // paragraph in three.
          const slice =
            blocks.childCount === 1 && blocks.child(0).type.name === NODE_NAMES.paragraph
              ? new Slice(blocks.child(0).content, 0, 0)
              : new Slice(blocks, 0, 0);
          view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
          return true;
        },
      },
      onUpdate({ editor: instance }) {
        // Serialising here rather than in the debounce is what makes the
        // comparison against the last saved body a comparison of *markdown*:
        // two different ProseMirror trees can be one markdown document.
        change.current(serializeDoc(asPmNode(instance.getJSON())));
      },
    },
    // Created once per mounted document. The reader gives this component a
    // `key` of the document id, so a navigation is a remount (and the outgoing
    // buffer flushes in `useAutosave`'s cleanup) while a rename or an SSE
    // refresh is not.
    [],
  );

  const publishEditor = useRef(onEditor);
  publishEditor.current = onEditor;
  useEffect(() => {
    publishEditor.current?.(editor);
    return () => {
      publishEditor.current?.(null);
    };
  }, [editor]);

  /**
   * The server's copy moved on — **an external change while the user is
   * typing**, and the one adoption path in this component.
   *
   * Applied only when this document has no editing session: while one is open
   * the incoming body waits, and the effect re-runs when the session settles
   * because `editing` is reactive — which is what makes the deferred update
   * land exactly once rather than never (sprint-011 TEST-35).
   *
   * **A `409` is this path** (SPEC.md §7). A refusal's document is published
   * into the same cache entry a refetch writes, so it arrives here as an
   * ordinary external change and waits exactly as one — which is why a conflict
   * landing mid-sentence cannot replace what the person is writing. The retry
   * that follows it is `useAutosave`'s, and it carries the buffer this editor
   * never gave up.
   *
   * **The document's own save echoes back through here, and is not adopted**
   * (PR #10 finding 18). A `PUT` invalidates the document, the refetch returns
   * the body the user just typed, and `canonical` changes to text the editor is
   * already showing. Adopting it replaces the ProseMirror document with an
   * identical one, which discards the caret, the selection and every anchor
   * decoration drawn on it — and then something downstream has to notice and
   * put them back. Comparing against what the editor would save is the same
   * comparison autosave makes, and it stops the wipe at its source rather than
   * repairing it after the fact.
   */
  const applied = useRef(canonical);
  useEffect(() => {
    if (editor === null || editing) return;
    if (canonical === applied.current) return;
    applied.current = canonical;
    if (canonical === serializeDoc(asPmNode(editor.getJSON()))) return;
    // `emitUpdate: false`: adopting the server's copy is not the user's edit
    // and must not start an autosave, which would write the document back to
    // itself.
    editor.commands.setContent(asContent(parseMarkdown(canonical)), { emitUpdate: false });
  }, [canonical, editing, editor]);

  useEffect(() => {
    publishStatus?.({ state: autosave.state, onRetry: autosave.retry });
  }, [autosave.retry, autosave.state, publishStatus]);

  const comment = useCallback(() => {
    if (editor === null || onComment === undefined) return;
    const { from, to } = editor.state.selection;
    onComment(
      buildSelection({
        docId,
        from,
        to,
        text: editor.state.doc.textBetween(from, to, "\n", ""),
        textBefore: editor.state.doc.textBetween(0, from, "\n", ""),
        body: serializeDoc(asPmNode(editor.getJSON())),
      }),
    );
  }, [docId, editor, onComment]);

  return (
    <div
      className="doc-editor"
      data-doc-editor={docId}
      /*
       * The whole editor subtree opts out of SPEC.md §10's single-letter
       * bindings, not just the contenteditable node inside it (UI-010's
       * `isWritingSurface`). ProseMirror re-targets key events and mounts node
       * views and a selection toolbar that can hold focus, so "is the caret in
       * a contenteditable" is nearly always right and occasionally not — and
       * the one time it is wrong, `c` opens a composer mid-sentence.
       */
      data-shortcuts="off"
    >
      <EditorContent editor={editor} />
      <SelectionToolbar editor={editor} onComment={comment} />
      {suggestion === null ? null : (
        <RefAutocomplete state={suggestion} keyHandler={suggestionKeys} />
      )}
    </div>
  );
}

/** Re-exported so a host can name the editor's own type without reaching inside. */
export type { Editor };
