import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import { useCreateThread, type RowNotice } from "@corpus/kit";
import type { Editor, EditorEvents } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useIsEditing } from "../editor/editingRegistry";
import { rangeStillReads, STALE_SELECTION_NOTICE, type EditorSelection } from "../editor/selection";
import type { AnchorReport } from "../editor/useAutosave";
import { useThreadCollapse } from "../thread/ThreadCollapseContext";
import {
  anchorDecorationPlugin,
  anchorPluginKey,
  setAnchorsTransaction,
  type AnchorPlacement,
} from "./anchorDecorations";
import {
  detachedThreads,
  isPlaced,
  placeAnchors,
  unplacedThreads,
  type AnchoredThread,
} from "./anchorPlacement";
import { escapeSelectorValue } from "./cssEscape";
import { selectorFromSelection, type AnchorSelection } from "./selectorFromSelection";
import { traceOfBody, traceOfDoc } from "./traceCache";

/**
 * Everything that has to agree for an anchor to be visible: the server's
 * ranges, the editor's positions, the layout mode, and the comment being
 * written right now.
 *
 * It is a hook rather than a component because the pieces land in three places
 * — decorations *inside* the editor, chips *between* its blocks, cards *beside*
 * it — and a component that owned all three would have to portal into two of
 * them anyway. `DocView` composes; this decides.
 *
 * The ordering rule that makes it safe: **server data is applied only when the
 * editor is showing exactly the body those offsets index into.** While there
 * are unsaved edits the highlights ride on the transaction mapping instead, and
 * the deferred application lands the moment the two agree again. Applying a
 * report against a document it was not computed for is how a highlight ends up
 * over the wrong sentence — the one failure mode worse than no highlight.
 */

/** Above this width a column reader is wide enough for margin cards. */
export const MARGIN_MIN_WIDTH = 1100;

/** How long the layer waits after a document change before re-checking the anchors. */
export const REAPPLY_DEBOUNCE_MS = 120;

export interface AnchorLayerOptions {
  readonly docId: string;
  /** The body as the server holds it — what `anchors[].range` indexes into. */
  readonly body: string;
  readonly anchors: readonly ResolvedAnchor[];
  /** Threads on this document, from `GET /api/docs?parent=…&type=thread`. */
  readonly threads: readonly DocRow[];
  /** Another party holds the lock: no selection toolbar, no comment creation (SPEC.md §7). */
  readonly locked: boolean;
  /** The document is rendered by the editor at all — a `view` or a thread is not. */
  readonly editable: boolean;
  /** The thread the 💬 popover just jumped to; its anchor is scrolled to. */
  readonly flashThread?: string | null;
  readonly onNotify: (notice: RowNotice) => void;
}

export interface CommentDraft {
  readonly selection: AnchorSelection;
  /** The ProseMirror range the optimistic highlight paints, captured on open. */
  readonly range: { readonly from: number; readonly to: number };
  readonly top: number;
  readonly left: number;
}

export interface AnchorLayer {
  /** The column the document is in; the margin measures against it. */
  readonly mainRef: RefObject<HTMLDivElement | null>;
  readonly marginRef: RefObject<HTMLDivElement | null>;
  /**
   * The body's live editor, or `null` when the body is not one.
   *
   * Published because this layer is already the only thing that holds it, and
   * the selection context menu (SPEC.md §11) has to act on the same instance —
   * a second subscription to `DocEditor.onEditor` would be a second source of
   * truth for one editor.
   */
  readonly editor: Editor | null;
  /** `DocEditor` props. */
  readonly onEditor: (editor: Editor | null) => void;
  readonly onComment: (selection: EditorSelection) => void;
  /**
   * The live selection as a comment action, captured now — SPEC.md §11's
   * "Comment on selection", which is 💬's own act reached by right-click.
   *
   * Returns `null` when there is nothing to comment on: no editor, a foreign
   * lock, or a selection with no quotable text. The range is read here rather
   * than when the action runs, because opening the menu moves focus out of the
   * body and the composer must anchor to the words that were right-clicked.
   */
  readonly captureComment: () => (() => void) | null;
  readonly onAnchors: (report: AnchorReport) => void;
  /**
   * Threads drawn **at their anchor**, in document order — chips or margin
   * cards.
   *
   * Only the ones with somewhere to sit: an anchor with no segments has no
   * position, and giving it one is how a comment ends up reading as a comment on
   * the title (`anchorPlacement.segmentsOf`). Those arrive in
   * {@link AnchorLayer.unplaced} instead.
   */
  readonly anchored: readonly AnchoredThread[];
  readonly wholeDocument: readonly DocRow[];
  readonly orphaned: readonly DocRow[];
  /** Anchored and resolved, but with nothing on this screen to sit beside. */
  readonly unplaced: readonly DocRow[];
  /** True when the cards belong in the margin rather than in chips at the anchor. */
  readonly marginMode: boolean;
  /** The element a chip renders into, in chip mode. */
  readonly slotHost: (threadId: string) => HTMLElement | null;
  readonly draft: CommentDraft | null;
  readonly submitting: boolean;
  readonly submitComment: (body: string, requestsAgent: boolean) => void;
  readonly cancelComment: () => void;
}

/** A report, and the anchors payload it was answering about. */
interface ReportedAgainst {
  readonly report: AnchorReport;
  readonly against: readonly ResolvedAnchor[];
}

interface Optimistic {
  readonly key: string;
  readonly quote: string;
  readonly segments: readonly { readonly from: number; readonly to: number }[];
}

export function useAnchorLayer(options: AnchorLayerOptions): AnchorLayer {
  const { docId, body, anchors, threads, locked, editable, flashThread = null, onNotify } = options;
  const collapse = useThreadCollapse();
  const rows = useRef(threads);
  rows.current = threads;

  const mainRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [marginMode, setMarginMode] = useState(false);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  const [report, setReport] = useState<ReportedAgainst | null>(null);

  /**
   * The comment's **outcome**, reported from the hook rather than from the call
   * (UI-015).
   *
   * A per-call `onSuccess`/`onError` is delivered through the mutation's
   * observer and skipped once that observer has no listeners left, so closing
   * the reader while a comment is in flight used to swallow both the server's
   * warnings and the failure notice — the user is told nothing about a comment
   * that may or may not have landed. Hook-level callbacks ride on the mutation
   * itself and fire wherever the layer went (`SettledCallbacks`).
   *
   * Only the telling moves. Clearing the optimistic highlight is a state update
   * on this layer, it means nothing once the layer is gone, and it stays on the
   * call in `post` where being skipped after unmount is the correct behaviour.
   */
  const createThread = useCreateThread({
    onSuccess: (result) => {
      for (const warning of result.warnings) {
        onNotify({ tone: "error", message: `${warning.code} — ${warning.detail}` });
      }
    },
    onError: (error) => {
      onNotify({ tone: "error", message: `Comment failed — ${error.message}` });
    },
  });
  const editing = useIsEditing(docId);

  /* ── The plugin, and the two refs it reads through ─────────────────── */

  const activate = useRef<((threadId: string) => void) | undefined>(undefined);
  const slotFor = useRef<((threadId: string) => HTMLElement | null) | undefined>(undefined);
  const hosts = useRef(new Map<string, HTMLElement>());

  const slotHost = useCallback((threadId: string): HTMLElement => {
    const existing = hosts.current.get(threadId);
    if (existing !== undefined) return existing;
    const element = document.createElement("div");
    element.className = "anchor-slot";
    element.setAttribute("data-anchor-slot", threadId);
    // Not editable and not part of the document: the chip is drawn between two
    // blocks, and a caret must never be able to land inside it.
    element.setAttribute("contenteditable", "false");
    hosts.current.set(threadId, element);
    return element;
  }, []);

  useEffect(() => {
    // The destroyed check guards the mount path as well as the cleanup: React 19
    // can run this passive effect after the editor it captured has already been
    // torn down, and `registerPlugin` on a destroyed view dereferences a null
    // `docView` inside ProseMirror rather than no-opping.
    if (editor === null || editor.isDestroyed) return undefined;
    editor.registerPlugin(anchorDecorationPlugin({ onActivate: activate, slotFor }));
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(anchorPluginKey);
    };
  }, [editor]);

  /* ── Placement ─────────────────────────────────────────────────────── */

  const source = useMemo(() => traceOfBody(body), [body]);

  const anchorsNow = useRef(anchors);
  anchorsNow.current = anchors;

  /**
   * The report's verdict, until the refetch it triggered arrives.
   *
   * A `PUT` answers with which anchors it orphaned; the ranges come one round
   * trip later from `GET /api/docs/{id}`. Honouring the verdict immediately is
   * what makes an orphaned thread move without a reload (sprint-011 TEST-112),
   * and tying the overlay to the anchors array it was reported against is what
   * makes it expire exactly when the server's own answer replaces it.
   */
  const overlay = report !== null && report.against === anchors ? report.report : null;

  const effective = useMemo<readonly ResolvedAnchor[]>(() => {
    if (overlay === null) return anchors;
    return anchors.map((anchor) =>
      overlay.orphaned.includes(anchor.anchorId)
        ? { ...anchor, orphaned: true, range: null }
        : anchor,
    );
  }, [anchors, overlay]);

  const all = useMemo(
    () => placeAnchors({ anchors: effective, rows: threads, body, source }),
    [body, effective, source, threads],
  );

  const anchored = useMemo(() => all.filter(isPlaced), [all]);
  const unplaced = useMemo(() => unplacedThreads(all), [all]);

  const detached = useMemo(() => detachedThreads(threads, effective), [effective, threads]);

  const placements = useMemo<AnchorPlacement[]>(() => {
    const live = anchored.map((thread) => thread.placement);
    if (optimistic === null) return live;
    return [
      ...live,
      {
        anchorId: optimistic.key,
        threadId: optimistic.key,
        resolved: false,
        turnCount: 1,
        segments: optimistic.segments,
      },
    ];
  }, [anchored, optimistic]);

  /* ── Applying server data, but only against the body it describes ──── */

  const desired = useRef<readonly AnchorPlacement[]>([]);
  const wanted = useRef<string>(source.markdown);
  const applyAnchors = useCallback((): void => {
    if (editor === null || editor.isDestroyed) return;
    // The offsets belong to a body; applying them to a different one would put
    // a highlight over the wrong sentence. Declining is what leaves the local
    // mapping in charge until the two agree again.
    if (traceOfDoc(editor.state.doc).markdown !== wanted.current) return;
    editor.view.dispatch(setAnchorsTransaction(editor.state, desired.current));
  }, [editor]);

  useEffect(() => {
    desired.current = placements;
    wanted.current = source.markdown;
    applyAnchors();
  }, [applyAnchors, placements, source.markdown]);

  // Chip mode puts a widget between blocks, so the set has to be rebuilt when
  // the mode flips as well as when the anchors change.
  useEffect(() => {
    slotFor.current = (threadId) => (marginMode ? null : slotHost(threadId));
    applyAnchors();
  }, [applyAnchors, marginMode, slotHost]);

  /**
   * Re-apply after any change to the document this layer did not make.
   *
   * Two of them matter and neither is the user typing. A **deferred**
   * application lands the moment the editor's text comes back into agreement
   * with the body the offsets describe. And a **replaced document** — what
   * `DocEditor` does when the server's copy moves on — throws every decoration
   * away, because a wholesale replacement maps every range to nothing.
   *
   * That used to include the echo of this document's *own* save, and the wipe
   * was repaired here rather than avoided; `DocEditor` now declines to adopt a
   * body the editor is already showing (PR #10 finding 18), so what reaches
   * this handler is a genuine external change — somebody else's write, or the
   * agent's. The repair stays, because that case still replaces the document.
   *
   * Debounced to a trailing tick so a burst of typing costs one check, and
   * `applyAnchors` is a no-op whenever the two texts disagree — so the local
   * mapping, not this, is what carries a highlight through an edit.
   *
   * **A replacement is not typing, and it does not wait out the debounce.** The
   * effect above re-applies in the same commit as an adoption it can see, but
   * the adoption often lands in a *later* commit than the body it adopts — the
   * incoming copy waits for the editing session to settle, and `editing`
   * changing re-renders this hook without changing any of that effect's
   * dependencies. In that ordering the wipe is repaired only here, and a
   * debounced repair means every highlight in the document blinks off and back
   * on after a save. TipTap marks exactly the adoption transaction
   * `preventUpdate` (`setContent(…, false)` in `DocEditor`, which is the only
   * caller), so that is the signal to re-apply on this tick instead. A
   * microtask, not a synchronous call: a dispatch is in flight, and the repair
   * still lands in the same frame.
   */
  useEffect(() => {
    if (editor === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reapply = (): void => {
      timer = null;
      applyAnchors();
    };
    const onTransaction = ({ transaction }: EditorEvents["transaction"]): void => {
      if (!transaction.docChanged) return;
      if (transaction.getMeta(anchorPluginKey) !== undefined) return;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (transaction.getMeta("preventUpdate") === true) {
        queueMicrotask(reapply);
        return;
      }
      timer = setTimeout(reapply, REAPPLY_DEBOUNCE_MS);
    };
    editor.on("transaction", onTransaction);
    return () => {
      if (timer !== null) clearTimeout(timer);
      editor.off("transaction", onTransaction);
    };
  }, [applyAnchors, editor]);

  /* ── Layout mode ───────────────────────────────────────────────────── */

  // Only placeable anchors count: a margin whose cards have no highlights to sit
  // beside is a margin with nothing to align to (UI-062).
  const anchoredCount = anchored.length;

  useEffect(() => {
    const element = mainRef.current;
    if (element === null || !editable) {
      setMarginMode(false);
      return undefined;
    }
    // Focus mode is always wide enough; a column has to be measured.
    const inFocus = element.closest(".focus-inner") !== null;
    const decide = (): void => {
      setMarginMode(anchoredCount > 0 && (inFocus || element.clientWidth >= MARGIN_MIN_WIDTH));
    };
    decide();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(decide);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [anchoredCount, editable]);

  /**
   * `.focus-inner.with-margin` is the grid the cards sit in, and it belongs to
   * the host — focus mode's inner column, or the column reader's scroller.
   * Toggling it from here is what the prototype does, and it keeps two
   * components from having to know about a third's layout state.
   */
  useEffect(() => {
    const element = mainRef.current;
    const host = element?.closest(".focus-inner") ?? element?.parentElement ?? null;
    if (host === null) return undefined;
    host.classList.toggle("with-margin", marginMode);
    return () => {
      host.classList.remove("with-margin");
    };
  }, [marginMode]);

  /* ── Opening a thread from a highlight ─────────────────────────────── */

  /**
   * Clicking an anchored highlight opens its thread — and **expands** it, which
   * is the reader's own act and therefore overrides the rule (SPEC.md §11's
   * precedence). A resolved conversation folded by default is still one click
   * away from its own highlight, which is the route back the "collapsed is never
   * hidden" clause promises: the passage keeps saying it has been discussed.
   */
  const expand = useRef(collapse.expand);
  expand.current = collapse.expand;

  useEffect(() => {
    activate.current = (threadId: string) => {
      const row = rows.current.find((candidate) => candidate.id === threadId);
      if (row !== undefined) {
        expand.current({ threadId, status: row.status, unread: row.unread === true });
      }
      const panel = marginRef.current?.querySelector<HTMLElement>(
        `:scope > [data-thread-panel="${escapeSelectorValue(threadId)}"]`,
      );
      if (panel !== null && panel !== undefined && typeof panel.scrollIntoView === "function") {
        panel.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
  }, []);

  /**
   * The 💬 popover jumped to a thread: bring its anchor into view.
   *
   * The card scrolls itself (UI-008 does that on `flashing`); this is the other
   * half of "jumps to its anchor" — the highlighted words themselves, which in
   * a long document are what the person is actually looking for.
   */
  useEffect(() => {
    if (flashThread === null) return;
    const highlight = mainRef.current?.querySelector<HTMLElement>(
      `.anchor-hl[data-thread="${escapeSelectorValue(flashThread)}"]`,
    );
    if (highlight === null || highlight === undefined) return;
    if (typeof highlight.scrollIntoView === "function") {
      highlight.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [flashThread]);

  /* ── Commenting ────────────────────────────────────────────────────── */

  const onEditor = useCallback((instance: Editor | null) => {
    setEditor(instance);
  }, []);

  const openDraft = useCallback(
    (from: number, to: number) => {
      if (editor === null || locked) return;
      const live = traceOfDoc(editor.state.doc);
      const anchor = selectorFromSelection(live, { from, to });
      if (anchor === null) {
        onNotify({
          tone: "error",
          message: "That selection has no text to quote — select some words to comment on.",
        });
        return;
      }
      // The fallbacks hold when the position is momentarily out of the DOM:
      // the popover still opens, at the top of the viewport, rather than not
      // opening at all.
      let top = 80;
      let left = 0;
      try {
        const coords = editor.view.coordsAtPos(to);
        top = coords.bottom + 6;
        left = coords.left;
      } catch {
        // keep the fallbacks
      }
      setDraft({ selection: anchor, range: { from, to }, top, left });
    },
    [editor, locked, onNotify],
  );

  /**
   * 💬 hands over the whole payload; only the two positions are used, because
   * the selector is re-derived from the *live* document rather than from the
   * body the toolbar serialized (a save may have landed in between).
   */
  const onComment = useCallback(
    (selection: EditorSelection) => {
      openDraft(selection.from, selection.to);
    },
    [openDraft],
  );

  const captureComment = useCallback((): (() => void) | null => {
    if (editor === null || editor.isDestroyed || locked || !editable) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty) return null;
    const quoted = editor.state.doc.textBetween(from, to, "\n", "");
    if (quoted.trim() === "") return null;
    return () => {
      if (editor.isDestroyed) return;
      // The menu can sit open across an SSE-driven adoption of a new body, and
      // the captured positions then point at other words — or, on a shrunken
      // document, past its end (PR #13 review, MINOR). Quoting the wrong
      // sentence is the one failure the anchor layer exists to prevent.
      if (!rangeStillReads(editor.state.doc, from, to, quoted)) {
        onNotify({ tone: "error", message: STALE_SELECTION_NOTICE });
        return;
      }
      openDraft(from, to);
    };
  }, [editable, editor, locked, onNotify, openDraft]);

  const onAnchors = useCallback((incoming: AnchorReport): void => {
    setReport((current) => {
      // Out-of-order responses are dropped: a report from an older revision
      // describes a body two saves ago (sprint-011 TEST-109).
      if (current !== null && incoming.revision <= current.report.revision) return current;
      // Bound, here and not in an effect, to the anchors array it arrived
      // against — so the overlay expires exactly when the refetch replaces it,
      // and applies on the render that carries it rather than one after.
      return { report: incoming, against: anchorsNow.current };
    });
  }, []);

  // Bound to the anchors array the report arrived against, so that the overlay
  // stops applying the moment the refetch lands.
  /**
   * A comment submitted while a save is outstanding waits for it.
   *
   * The selector quotes the live document; the server must be holding that
   * same document when it resolves it, or the anchor arrives orphaned. The
   * editing registry answers exactly that question — it clears only when no
   * buffer is pending and no `PUT` is in flight (sprint-011 TEST-107).
   */
  const queued = useRef<{ body: string; requestsAgent: boolean } | null>(null);

  const post = useCallback(
    (input: { body: string; requestsAgent: boolean }, anchor: AnchorSelection, key: string) => {
      // The temp highlight goes: on success the server's own anchor arrives with
      // the refetched document and takes its place, and on a refusal there is
      // nothing to take its place at all. Per-call on purpose — a highlight in a
      // reader that has closed is not something anyone can see, and clearing it
      // there would be a state update on a dead layer (UI-015). The notices ride
      // on the hook above, which is what makes skipping this one safe.
      const forget = (): void => {
        setOptimistic((current) => (current?.key === key ? null : current));
      };
      createThread.mutate(
        {
          parent: docId,
          selector: anchor.selector,
          body: input.body,
          requestsAgent: input.requestsAgent,
        },
        { onSuccess: forget, onError: forget },
      );
    },
    [createThread, docId],
  );

  const pendingAnchor = useRef<{ anchor: AnchorSelection; key: string } | null>(null);

  const submitComment = useCallback(
    (text: string, requestsAgent: boolean) => {
      if (draft === null) return;
      const anchor = draft.selection;
      const key = `pending:${String(Date.now())}`;
      // Painted from the range the popover was opened on, not from the live
      // selection: opening the composer moved focus out of the editor.
      setOptimistic({ key, quote: anchor.selector.exact, segments: [draft.range] });
      setDraft(null);
      if (editing) {
        queued.current = { body: text, requestsAgent };
        pendingAnchor.current = { anchor, key };
        return;
      }
      post({ body: text, requestsAgent }, anchor, key);
    },
    [draft, editing, post],
  );

  useEffect(() => {
    if (editing) return;
    const job = queued.current;
    const target = pendingAnchor.current;
    if (job === null || target === null) return;
    queued.current = null;
    pendingAnchor.current = null;
    post(job, target.anchor, target.key);
  }, [editing, post]);

  const cancelComment = useCallback(() => {
    setDraft(null);
  }, []);

  return {
    mainRef,
    marginRef,
    editor,
    onEditor,
    onComment,
    captureComment,
    onAnchors,
    anchored,
    wholeDocument: detached.wholeDocument,
    orphaned: detached.orphaned,
    unplaced,
    marginMode,
    slotHost: useCallback(
      (threadId: string) => (marginMode ? null : slotHost(threadId)),
      [marginMode, slotHost],
    ),
    draft,
    submitting: createThread.isPending,
    submitComment,
    cancelComment,
  };
}
