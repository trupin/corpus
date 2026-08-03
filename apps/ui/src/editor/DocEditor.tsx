import { getSchema } from "@tiptap/core";
import { Node as PmModelNode, Slice } from "@tiptap/pm/model";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
import { canonicalizeMarkdown, serializeDoc } from "./markdown/serialize.js";
import type { PmNode } from "./markdown/schema.js";
import { createRefSuggestion, type RefSuggestionState } from "./refSuggestion.js";
import { useSaveStatusPublisher } from "./SaveChip.js";
import { buildSelection, type EditorSelection } from "./selection.js";
import { useAutosave, type AnchorReport } from "./useAutosave.js";
import { useUserLock } from "./useUserLock.js";
import "./editor.css";

/**
 * The document body, always editable (SPEC.md §11).
 *
 * There is no edit mode and no button: the body *is* the editor, you click
 * where you want to write and you write. Everything that used to be a mode is
 * now a consequence — the caret is `var(--accent)` because the surface is
 * editable, and a locked document is the same surface with `editable: false`
 * rather than a different component (sprint-011 Adjudication 7). Keeping one
 * surface is what preserves scroll, selection and — once UI-007 lands — anchor
 * decorations across the lock boundary.
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
 * frontmatter, not its prose. Everything else is a markdown body, and §11 says
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
 * `CORE_DOC_TYPES`, which made a plugin-typed document — and any document whose
 * plugin had since been deleted — render through the static `MarkdownView`: a
 * body a person could read and not correct, in a product whose §11 principle is
 * that there is no edit mode. §10's "a removed plugin's documents render as
 * plain markdown" is about the absence of the plugin's *chrome*, not about the
 * body turning read-only; sprint-011 adjudicated "the editor owns doc bodies
 * always".
 *
 * A registered plugin `View` still wins, because it replaces the standard
 * document view wholesale. That precedence is not decided here — this answers
 * about the type alone, and `DocView` asks the plugin registry first — so a
 * plugin installed or deleted mid-session flips its documents between its
 * `View` and this editor with no second gate to keep in step.
 */
export function editorHandlesType(type: string): boolean {
  return !NON_EDITABLE_TYPES.has(type);
}

export interface DocEditorProps {
  readonly docId: string;
  /** The body as the server holds it. */
  readonly body: string;
  /** Another party holds the edit lock (SPEC.md §7) — the surface goes read-only. */
  readonly locked: boolean;
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
  locked,
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
   */
  const canonical = useMemo(() => canonicalizeMarkdown(body), [body]);

  const openRef = useRef<OpenRefCallback>(onOpenRef);
  openRef.current = onOpenRef;

  const [suggestion, setSuggestion] = useState<RefSuggestionState | null>(null);
  const suggestionKeys = useRef<((event: KeyboardEvent) => boolean) | null>(null);

  const autosave = useAutosave({ docId, savedBody: canonical, locked, onAnchors });
  const userLock = useUserLock({ docId, enabled: !locked });
  const publishStatus = useSaveStatusPublisher();
  const editing = useIsEditing(docId);

  const change = useRef(autosave.change);
  change.current = autosave.change;
  const touch = useRef(userLock.touch);
  touch.current = userLock.touch;

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
    ],
    [],
  );

  /**
   * The clipboard's two flavors (SPEC.md §11 clipboard rider), built once
   * beside the schema they serialize.
   *
   * The resolver is read through a box for the same reason `openRef` is: it
   * closes over the query cache, and rebuilding either serializer would rebuild
   * the schema underneath the live document.
   */
  const queryClient = useQueryClient();
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
      editable: !locked,
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
          // Announced, because the surface looks identical when it is not
          // writable and a caret that silently swallows keystrokes is worse
          // than a control that says it is read-only.
          "aria-readonly": locked ? "true" : "false",
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
         * So the first Escape blurs — which also gives the edit lock back —
         * and the second reaches the chain and closes the layer. Leaving the
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
        touch.current();
      },
    },
    // Created once per mounted document. The reader gives this component a
    // `key` of the document id, so a navigation is a remount (and the outgoing
    // buffer flushes in `useAutosave`'s cleanup) while a lock, a rename or an
    // SSE refresh is not.
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

  /** The lock arrived or cleared: toggle, never remount (sprint-011 TEST-33). */
  useEffect(() => {
    if (editor === null) return;
    editor.setEditable(!locked, false);
    editor.view.dom.setAttribute("aria-readonly", locked ? "true" : "false");
  }, [editor, locked]);

  /**
   * The server's copy moved on.
   *
   * Applied only when this document has no editing session: while one is open
   * the incoming body waits, and the effect re-runs when the session settles
   * because `editing` is reactive — which is what makes the deferred update
   * land exactly once rather than never (sprint-011 TEST-35).
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
    // `false`: adopting the server's copy is not the user's edit and must not
    // start an autosave, which would write the document back to itself.
    editor.commands.setContent(asContent(parseMarkdown(canonical)), false);
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
      data-editable={locked ? "false" : "true"}
      /*
       * The whole editor subtree opts out of SPEC.md §11's single-letter
       * bindings, not just the contenteditable node inside it (UI-010's
       * `isWritingSurface`). ProseMirror re-targets key events and mounts node
       * views and a selection toolbar that can hold focus, so "is the caret in
       * a contenteditable" is nearly always right and occasionally not — and
       * the one time it is wrong, `c` opens a composer mid-sentence.
       */
      data-shortcuts="off"
    >
      <EditorContent
        editor={editor}
        onBlur={() => {
          userLock.blur();
        }}
      />
      <SelectionToolbar editor={editor} enabled={!locked} onComment={comment} />
      {suggestion === null || locked ? null : (
        <RefAutocomplete state={suggestion} keyHandler={suggestionKeys} />
      )}
    </div>
  );
}

/** Re-exported so a host can name the editor's own type without reaching inside. */
export type { Editor };
