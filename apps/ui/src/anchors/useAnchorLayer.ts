import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import {
  CorpusRequestError,
  releaseAttachments,
  useCreateThread,
  type PendingAttachment,
  type RowNotice,
} from "@corpus/kit";
import type { Editor, EditorEvents } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { expandClipAround } from "../editor/changelogClip";
import { useIsEditing } from "../editor/editingRegistry";
import { editorBody } from "../editor/editorBody.js";
import { rangeStillReads, STALE_SELECTION_NOTICE, type EditorSelection } from "../editor/selection";
import type { AnchorReport } from "../editor/useAutosave";
import { MARGIN_COLUMN_RESERVE } from "../reader/docWidth";
import { useThreadCollapse } from "../thread/ThreadCollapseContext";
import { readStateOf } from "../thread/threadCollapse";
import { restoredRecipient, type CommentRestore } from "./CommentPopover";
import {
  anchorDecorationPlugin,
  anchorPluginKey,
  anchorState,
  claimProvisionalTransaction,
  setAnchorsTransaction,
  setProvisionalTransaction,
  type AnchorPlacement,
} from "./anchorDecorations";
import type { PmRange } from "./offsetMap";
import { POPOVER_ANCHOR_GAP, type PopoverAnchor } from "./popoverDrag";
import {
  detachedThreads,
  isPlaced,
  placeAnchors,
  summaryFromAnchor,
  unplacedThreads,
  type AnchoredThread,
} from "./anchorPlacement";
import { escapeSelectorValue } from "./cssEscape";
import {
  selectorFromSelection,
  type AnchorSelection,
  type SelectionRefusal,
} from "./selectorFromSelection";
import { traceOfBody, traceOfDoc, type DocumentTrace } from "./traceCache";

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

/**
 * The narrowest body the margin may leave behind: `62ch` of the shipped 15px
 * serif, which is `.doc-body`'s own default measure in `@corpus/kit`'s
 * `markdown.css`. Measured at 517.3px in Chromium (the rail reads 66ch of the
 * 16.5px serif as 605.65px, so a `ch` is 0.5562 × the size), and rounded down.
 *
 * The rule it states: **the margin may take the room the document does not
 * need, and never the room the document does.** Below this a column would be
 * giving a conversation a column of its own at the cost of the prose it is
 * about.
 */
const MARGIN_BODY_MIN = 520;

/**
 * The room a reader needs before its anchored conversations move to the margin
 * (SPEC.md §10 — *"in focus mode and wide layouts, threads sit Docs-style in
 * the right margin"*).
 *
 * **Measured on the host — the box the `.with-margin` grid is applied to — and
 * never on `.doc-main`.** That is a correctness condition, not a preference.
 * The margin's 330px comes *out of* `.doc-main`: a threshold read off
 * `.doc-main` is a threshold the margin itself falsifies, so the class turns on,
 * the body shrinks below the threshold, the class turns off, and the reader
 * flickers forever. Measured live at a 900px column with the old `.doc-main`
 * reading and a lowered constant: **62 class mutations in 1500ms**, settling on
 * no margin at all (UI-165's log).
 *
 * The host's box is read border-box (`getBoundingClientRect`) less its own
 * padding and border, so a scrollbar appearing inside it does not move the
 * threshold either — the same flicker, one pixel wide, arriving by a different
 * route.
 *
 * **Why 850 and not 1100** (UI-165, user decision 2026-08-23). `MAX_COLUMN_WIDTH`
 * is 960 and a column's host content is its width less 30px, so 1100 was a
 * threshold no drag could reach: §10's "wide layouts" clause was dead in a
 * column at every width, and UI-163 could only prove the margin's geometry by
 * applying the class by hand. 850 is {@link MARGIN_BODY_MIN} plus the margin's
 * own {@link MARGIN_COLUMN_RESERVE}, so a column earns its margin from about
 * 880px of width up to the 960px stop, and at the stop the body keeps ~600px.
 *
 * The cost is the user's, stated and accepted: a column at its widest reads
 * narrower than full screen's default measure once the margin takes its 330px.
 */
export const MARGIN_MIN_WIDTH = MARGIN_BODY_MIN + MARGIN_COLUMN_RESERVE;

/** A length off `getComputedStyle`, or 0 — jsdom answers `""` for all of them. */
function cssPx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The element the `.with-margin` grid belongs to: focus mode's inner column, or
 * the column reader's scroller. Both effects below resolve it through here, so
 * the box that is *measured* and the box the class is *applied to* can never be
 * two different elements.
 */
function marginHost(main: HTMLElement): Element | null {
  return main.closest(".focus-inner") ?? main.parentElement;
}

/** The host's content box, read so that a scrollbar inside it changes nothing. */
function marginRoom(host: Element): number {
  const style = getComputedStyle(host);
  const inset =
    cssPx(style.paddingLeft) +
    cssPx(style.paddingRight) +
    cssPx(style.borderLeftWidth) +
    cssPx(style.borderRightWidth);
  return host.getBoundingClientRect().width - inset;
}

/** What a selection that cannot become an anchor is told (UI-068). */
export const REFUSAL_NOTICE: Record<SelectionRefusal, string> = {
  "no-quote": "That selection has no text to quote — select some words to comment on.",
  "not-in-file":
    "Couldn't quote that selection from the document as it is saved — select a whole phrase and try again.",
};

/**
 * What a comment the server refused says.
 *
 * `POST /api/threads` answers `400` when the quote names more than one passage
 * (SERVER-071): an underspecified request rather than a broken one, and §6
 * would rather refuse at creation than guess which passage a conversation is
 * about. But the sentence it refuses with is written for an API caller — it asks
 * for `prefix`/`suffix` copied out of the file — and that is not an act
 * available to someone holding a mouse. This layer *always* sends them, read off
 * the file's own bytes, so reaching that refusal means even the framed quote
 * repeats, and the only thing that helps is selecting more.
 *
 * The other `400` on `selector.exact` is a blank quote, which cannot arrive from
 * here: `isCommentable` refuses a whitespace-only selection before a draft is
 * ever opened.
 */
export function commentFailureNotice(error: Error): string {
  const ambiguous =
    error instanceof CorpusRequestError &&
    error.issues.some((issue) => issue.path === "selector.exact");
  return ambiguous
    ? "That passage appears more than once, and the words around it are identical too — " +
        "select a longer stretch that includes something unique."
    : `Comment failed — ${error.message}`;
}

/**
 * The bytes the selector will be resolved against — the whole point of UI-068.
 *
 * It is the **file**, `body` exactly as the server holds it, whenever the editor
 * is showing the file's own document. The test for that is not string equality
 * with `body`: a file the printer spells differently is still the same document,
 * and that difference is precisely the case this exists for. It is equality of
 * the two *printings* — `file` is the trace of what the editor was handed
 * (`traceOfBody(editorBody(body))`, the `source` memo below) and `live` is
 * `traceOfDoc(doc)`, so equal output means the editor holds nothing the file
 * does not already say.
 *
 * **`file` must be the trace of `editorBody(body)` and not of `body`** — that is
 * the second half of UI-099, and it is a correctness condition on the caller
 * rather than a nicety. Where `canonicalizeMarkdown` is not idempotent the two
 * differ, and tracing `body` made this read a *structural* disagreement between
 * the two printings as "the editor has unsaved edits": it then handed back the
 * printer's spelling, a quote containing bytes that are in no file, and §6's
 * ladder had nothing to match at any rung — the comment orphaned at creation,
 * which is the failure UI-068 exists to prevent. Pinned by
 * `useAnchorLayer.test.tsx`'s "a file whose two printings disagree about
 * structure", which refuses that selection instead.
 *
 * When they differ for the ordinary reason, the editor holds unsaved edits, and
 * a comment submitted then waits for the save (see `submitComment`'s `editing`
 * gate). What that save writes is the editor's own printing, so that — not the
 * stale file — is the document the selector is going to meet.
 */
function quotableSource(body: string, file: DocumentTrace, live: DocumentTrace): string {
  return file.markdown === live.markdown ? body : live.markdown;
}

/** How long the layer waits after a document change before re-checking the anchors. */
export const REAPPLY_DEBOUNCE_MS = 120;

/**
 * How long an accepted comment's mark waits for the anchor that is coming to
 * take it over, before it gives up and goes out (UI-121).
 *
 * The handover itself needs no clock — the plugin ends the mark in the same
 * transaction that draws the anchor. This is the other branch: a document read
 * that fails, or an anchor the server could not place, would otherwise leave a
 * highlight up over words nothing owns, and there is no later event that would
 * ever take it down. Generous, because the only cost of waiting is a mark that
 * is still telling the truth, and the cost of being early is the blink this
 * issue exists to remove.
 */
export const HANDOVER_TIMEOUT_MS = 10_000;

export interface AnchorLayerOptions {
  readonly docId: string;
  /** The body as the server holds it — what `anchors[].range` indexes into. */
  readonly body: string;
  readonly anchors: readonly ResolvedAnchor[];
  /** Threads on this document, from `GET /api/docs?parent=…&type=thread`. */
  readonly threads: readonly DocRow[];
  /**
   * Whether {@link threads} is that query's answer rather than the empty array
   * it reports while in flight — what tells a placement the difference between
   * "no row yet" and "no row, ever" (`anchorPlacement.AnchoredThread.rowKnown`).
   */
  readonly threadsSettled: boolean;
  /** The document is rendered by the editor at all — a `view` or a thread is not. */
  readonly editable: boolean;
  /** The thread the 💬 popover just jumped to; its anchor is scrolled to. */
  readonly flashThread?: string | null;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * A comment on its way out — held whole, so one that waits for an edit session
 * to flush is posted exactly as it was written (SPEC.md §10's rider adds the
 * weight to what "as it was written" covers).
 */
interface CommentPost {
  readonly body: string;
  readonly requestsAgent: boolean;
  /**
   * What the composer stated, spread onto the request; `{}` when it stated
   * nothing. The weight the work should be done at (SPEC.md §10) and the lane it
   * was addressed to (§7) — the latter present whenever somebody **picked** one,
   * including a pick that names the lane the composer had already computed,
   * because only a default nobody touched travels by being absent (UI-118).
   */
  readonly stated: { readonly weight?: string; readonly recipient?: string };
  /**
   * The composer's attachments, held with the rest of it — a comment that waits
   * out an edit session keeps its screenshot the way it keeps its words (§6).
   * This layer owns their previews from here until the post settles.
   */
  readonly files: readonly PendingAttachment[];
}

export interface CommentDraft {
  readonly selection: AnchorSelection;
  /** The ProseMirror range the provisional highlight was opened on. */
  readonly range: PmRange;
  /** The words' two edges, for a composer that picks its own side (UI-159). */
  readonly anchor: PopoverAnchor;
  /**
   * Present only on a draft the layer re-opened because the server refused it:
   * what the composer held when it closed, so it comes back holding the same
   * (UI-111). A fresh selection has none.
   */
  readonly restore?: CommentRestore;
}

export interface AnchorLayer {
  /** The column the document is in; the margin measures against it. */
  readonly mainRef: RefObject<HTMLDivElement | null>;
  readonly marginRef: RefObject<HTMLDivElement | null>;
  /**
   * The body's live editor, or `null` when the body is not one.
   *
   * Published because this layer is already the only thing that holds it, and
   * the selection context menu (SPEC.md §10) has to act on the same instance —
   * a second subscription to `DocEditor.onEditor` would be a second source of
   * truth for one editor.
   */
  readonly editor: Editor | null;
  /** `DocEditor` props. */
  readonly onEditor: (editor: Editor | null) => void;
  readonly onComment: (selection: EditorSelection) => void;
  /**
   * The live selection as a comment action, captured now — SPEC.md §10's
   * "Comment on selection", which is 💬's own act reached by right-click.
   *
   * Returns `null` when there is nothing to comment on: no editor, a foreign
   * a selection with no quotable text. The range is read here rather
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
  /**
   * The document's anchors as this layer currently believes them — the server's
   * list with a just-completed save's orphan verdict folded in.
   *
   * Published because a detached thread's *row* says it is detached and its
   * *anchor* says what it was about: the preserved selector a re-attach offer
   * searches for, and the live ranges of its neighbours, which SPEC.md §6
   * forbids it overlapping (UI-086).
   */
  readonly effectiveAnchors: readonly ResolvedAnchor[];
  /** Anchored and resolved, but with nothing on this screen to sit beside. */
  readonly unplaced: readonly DocRow[];
  /** True when the cards belong in the margin rather than in chips at the anchor. */
  readonly marginMode: boolean;
  /** The element a chip renders into, in chip mode. */
  readonly slotHost: (threadId: string) => HTMLElement | null;
  readonly draft: CommentDraft | null;
  readonly submitting: boolean;
  readonly submitComment: (
    body: string,
    requestsAgent: boolean,
    stated: { readonly weight?: string; readonly recipient?: string },
    /** Taken from the composer; this layer frees them once the post settles. */
    attachments?: readonly PendingAttachment[],
  ) => void;
  readonly cancelComment: () => void;
}

/** A report, and the anchors payload it was answering about. */
interface ReportedAgainst {
  readonly report: AnchorReport;
  readonly against: readonly ResolvedAnchor[];
}

/**
 * The words a comment is being written about, lit before the server has seen
 * them (UI-112).
 *
 * One highlight covers the whole life of one comment: it goes up when the
 * composer opens, stays up while the request is in flight, and comes down when
 * the comment is abandoned or when the server's own anchor arrives to replace
 * it — "the same paint by a different owner". The **key** is what makes a
 * response settling late clear only its own: a refusal that re-opens the
 * composer, followed by a second send, must not have the first response put out
 * the second one's mark.
 *
 * It is held apart from the placements because the placements are the server's
 * offsets into the *saved* body and are applied only while the editor agrees
 * with it (`applyAnchors`) — a provisional range is a live ProseMirror range and
 * has no such condition. That difference is not cosmetic: a comment written
 * during an editing session is exactly when the words most need marking, and it
 * is the one case the gate would have kept dark.
 */
interface Provisional {
  readonly key: string;
  readonly range: PmRange;
}

/**
 * The server accepted a comment, and named the conversation that now owns the
 * words its mark is on (UI-121).
 *
 * Held as state of its own rather than folded into {@link Provisional} because
 * the range in that state is stale from the composer's first keystroke — the
 * live one is the plugin's, mapped through every transaction since. Changing
 * `provisional` re-dispatches the range, which would drag the mark back onto
 * the offsets the words used to occupy, so what a claim changes must be a
 * different piece of state.
 */
interface Claim {
  /** The {@link Provisional.key} this is an answer about. */
  readonly key: string;
  readonly owner: string;
}

export function useAnchorLayer(options: AnchorLayerOptions): AnchorLayer {
  const {
    docId,
    body,
    anchors,
    threads,
    threadsSettled,
    editable,
    flashThread = null,
    onNotify,
  } = options;
  const collapse = useThreadCollapse();
  const rows = useRef(threads);
  rows.current = threads;
  const docIdRef = useRef(docId);
  docIdRef.current = docId;

  const mainRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [marginMode, setMarginMode] = useState(false);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [provisional, setProvisional] = useState<Provisional | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [report, setReport] = useState<ReportedAgainst | null>(null);
  /** Distinct per opening, and never two the same within one millisecond. */
  const drafts = useRef(0);

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
      onNotify({ tone: "error", message: commentFailureNotice(error) });
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

  /**
   * The trace of **the text the editor was actually handed** — not of the file.
   *
   * `DocEditor` does not parse `body`; it parses `canonicalizeMarkdown(body)`
   * (its `canonical` memo), and that is the document every position in this
   * layer is a position into. Tracing `body` instead quietly assumed
   * `canonicalizeMarkdown` was idempotent — that printing a file once and
   * printing it twice give the same text.
   *
   * For almost every document they do, which is why this held for so long. They
   * do not when re-parsing the printed form lands the text somewhere else: a
   * further paragraph of an outer list item, after a nested sublist, loses its
   * blank line on the first printing, and on the second is read as a
   * continuation of the **nested** item and indented to match. One printing says
   * two spaces, the next says four.
   *
   * The layer then held offsets into a text the editor was not showing, so
   * `applyAnchors` declined every time and **no highlight was ever drawn on that
   * document** (UI-099) — while `quotableSource` below, reading the same
   * disagreement as "the editor has unsaved edits", quoted the printer's
   * spelling instead of the file's, which is the very thing UI-068 exists to
   * prevent. Both follow from the same wrong premise, and both go with it.
   *
   * Tracing what the editor was handed makes the agreement structural rather
   * than lucky: this is `serialize(parse(editorBody(body)))` and the editor
   * prints `serialize(parse(editorBody(body)))`, the same expression, whether or
   * not the serializer is idempotent.
   *
   * {@link editorBody} is that expression, named once and imported by both call
   * sites — because "these two modules canonicalise the same way" is exactly the
   * kind of agreement that held by convention here and quietly stopped holding.
   * `DocEditor.test.tsx` asserts a real mounted editor's document prints it.
   */
  const source = useMemo(() => traceOfBody(editorBody(body)), [body]);

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
    () =>
      placeAnchors({
        anchors: effective,
        rows: threads,
        rowsSettled: threadsSettled,
        body,
        source,
      }),
    [body, effective, source, threads, threadsSettled],
  );

  const anchored = useMemo(() => all.filter(isPlaced), [all]);
  const unplaced = useMemo(() => unplacedThreads(all), [all]);

  const detached = useMemo(() => detachedThreads(threads, effective), [effective, threads]);

  const placements = useMemo<AnchorPlacement[]>(
    () => anchored.map((thread) => thread.placement),
    [anchored],
  );

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

  /**
   * The composer's own words, lit — and put out.
   *
   * Deliberately *not* routed through `applyAnchors`: that call declines
   * whenever the editor is showing anything but the saved body, which is the
   * correct rule for the server's offsets and the wrong one for a range read off
   * the live document a moment ago.
   *
   * It dispatches only when the draft changes, never on an ordinary re-render,
   * because after the first keystroke the plugin's copy of this range is the
   * mapped one and this state's copy is stale. Re-sending it would drag the
   * highlight back onto the offsets the words used to occupy.
   */
  useEffect(() => {
    if (editor === null || editor.isDestroyed) return;
    editor.view.dispatch(setProvisionalTransaction(editor.state, provisional?.range ?? null));
  }, [editor, provisional]);

  /**
   * The handover, and the deadline on it (UI-121).
   *
   * Sending does not put the mark out. The server answers with the thread it
   * created, that name is written onto the mark that is already up, and the
   * plugin ends the mark in the very transaction that first draws that
   * thread's anchor — so the words are never unlit and never lit twice.
   * Dropping the mark in the mutation's `onSuccess` instead, which is what this
   * replaces, left them dark for the whole of the document read that carries
   * the anchor: 244 ms measured against a real server one 250 ms round trip
   * away, and longer the further away the server is.
   *
   * The claim always lands before the anchors it is about. It is dispatched
   * from a state update enqueued in `onSuccess`, and the anchors cannot arrive
   * before the read that `onSuccess` invalidated has come back over the
   * network — a render is always cheaper than a round trip.
   *
   * The timer is the other branch, and the only one that needs a clock: a read
   * that never resolves, or an anchor the server could not place, produces no
   * transaction to hand over in. Guarded on the plugin still holding a mark,
   * so a completed handover costs nothing.
   */
  useEffect(() => {
    if (editor === null || editor.isDestroyed) return undefined;
    if (claim === null || provisional === null || provisional.key !== claim.key) return undefined;
    editor.view.dispatch(claimProvisionalTransaction(editor.state, claim.owner));
    const timer = setTimeout(() => {
      if (editor.isDestroyed) return;
      if (anchorState(editor.state)?.provisional == null) return;
      setProvisional((current) => (current?.key === claim.key ? null : current));
    }, HANDOVER_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [claim, editor, provisional]);

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
    const host = element === null ? null : marginHost(element);
    if (element === null || host === null || !editable) {
      setMarginMode(false);
      return undefined;
    }
    // Focus mode is always wide enough, and needs no observer to say so; a
    // column has to be measured, and it is the **host** that is measured — see
    // `MARGIN_MIN_WIDTH`, which will not survive being read off `.doc-main`.
    if (element.closest(".focus-inner") !== null) {
      setMarginMode(anchoredCount > 0);
      return undefined;
    }
    const decide = (): void => {
      setMarginMode(anchoredCount > 0 && marginRoom(host) >= MARGIN_MIN_WIDTH);
    };
    decide();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(decide);
    observer.observe(host);
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
    const host = element === null ? null : marginHost(element);
    if (host === null) return undefined;
    host.classList.toggle("with-margin", marginMode);
    return () => {
      host.classList.remove("with-margin");
    };
  }, [marginMode]);

  /* ── Opening a thread from a highlight ─────────────────────────────── */

  /**
   * Clicking an anchored highlight opens its thread — and **expands** it, which
   * is the reader's own act and therefore overrides the rule (SPEC.md §10's
   * precedence). A resolved conversation folded by default is still one click
   * away from its own highlight, which is the route back the "collapsed is never
   * hidden" clause promises: the passage keeps saying it has been discussed.
   */
  const expand = useRef(collapse.expand);
  expand.current = collapse.expand;
  /*
   * The placed anchors, for the conversations whose row has not arrived — a
   * document with more threads than one page of `useDocs` holds, or any document
   * in the beat before that list lands. Without this the highlight of such a
   * conversation was a dead click: no row, no subject, nothing expanded.
   */
  const placed = useRef(all);
  placed.current = all;

  useEffect(() => {
    activate.current = (threadId: string) => {
      const row = rows.current.find((candidate) => candidate.id === threadId);
      const anchor = placed.current.find((candidate) => candidate.threadId === threadId);
      if (row !== undefined) {
        expand.current({ threadId, status: row.status, readState: readStateOf(row.unread) });
      } else if (anchor !== undefined) {
        const summary = summaryFromAnchor(anchor, docIdRef.current);
        expand.current({ threadId, status: summary.status, readState: summary.readState });
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
   *
   * **And open the clip, when the anchor is inside one** (UI-089). SPEC.md §10:
   * "an anchor into a clipped entry still resolves — revealing that conversation
   * expands the clip rather than quietly failing to reach it." Resolving is
   * already true, because an anchor is matched against the document rather than
   * against the laid-out box, and the highlight is decorated whether or not it
   * is on screen — so without this the jump would land on a box zero pixels
   * tall, which is precisely the quiet failure the clause names. The expansion
   * dispatches a ProseMirror transaction, which repaints synchronously, so the
   * scroll below finds the entry already laid out.
   */
  useEffect(() => {
    if (flashThread === null) return;
    const highlight = mainRef.current?.querySelector<HTMLElement>(
      `.anchor-hl[data-thread="${escapeSelectorValue(flashThread)}"]`,
    );
    if (highlight === null || highlight === undefined) return;
    expandClipAround(highlight);
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
      if (editor === null) return;
      const live = traceOfDoc(editor.state.doc);
      const captured = selectorFromSelection(
        live,
        { from, to },
        quotableSource(body, source, live),
      );
      if (!captured.ok) {
        onNotify({ tone: "error", message: REFUSAL_NOTICE[captured.reason] });
        return;
      }
      const anchor = captured.selection;
      // The fallbacks hold when the position is momentarily out of the DOM:
      // the popover still opens, at the top of the viewport, rather than not
      // opening at all.
      let placement: PopoverAnchor = { below: 80, above: 80 - POPOVER_ANCHOR_GAP, left: 0 };
      try {
        // Both ends of the selection, not one: a box put **over** the words has
        // to clear the whole quote, and the quote's first line is where it
        // starts (UI-159).
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        placement = {
          below: end.bottom + POPOVER_ANCHOR_GAP,
          above: start.top - POPOVER_ANCHOR_GAP,
          left: end.left,
        };
      } catch {
        // keep the fallbacks
      }
      setDraft({ selection: anchor, range: { from, to }, anchor: placement });
      // Lit **on open**, which is the whole of UI-112's second half: the browser's
      // own selection is gone the moment focus moves into the composer, and
      // without this the words are unmarked for exactly as long as someone is
      // writing about them. A new key, so a response to an earlier comment
      // settling now cannot put this one out.
      drafts.current += 1;
      setProvisional({ key: `draft:${String(drafts.current)}`, range: { from, to } });
    },
    [body, editor, onNotify, source],
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
    if (editor === null || editor.isDestroyed || !editable) return null;
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
  }, [editable, editor, onNotify, openDraft]);

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
  const queued = useRef<CommentPost | null>(null);

  const post = useCallback(
    (input: CommentPost, source: CommentDraft, key: string | null) => {
      const anchor = source.selection;
      createThread.mutate(
        {
          parent: docId,
          selector: anchor.selector,
          body: input.body,
          requestsAgent: input.requestsAgent,
          // Absent unless the composer stated one; a comment that waited out an
          // edit session carries the weight it was written with, not the one
          // standing when the buffer finally flushed.
          ...input.stated,
          // Multipart or JSON is `useCreateThread`'s branch; an empty list must
          // not be sent as one, or a plain comment goes out as a file upload.
          ...(input.files.length === 0 ? {} : { files: input.files.map((held) => held.file) }),
        },
        {
          onSuccess: (result) => {
            // The mark is **not** put out here — it changes hands (UI-121).
            // Naming its owner is what lets the plugin end it in the same
            // transaction that draws the server's anchor, instead of leaving
            // the words dark for the read that carries one.
            //
            // Per-call on purpose: a highlight in a reader that has closed is
            // not something anyone can see, and this would be a state update on
            // a dead layer (UI-015). The notices ride on the hook above, which
            // is what makes skipping this one safe. A refusal claims nothing —
            // the composer re-opens on the same words, still lit, which is
            // UI-112's rule and is unchanged.
            if (key !== null) setClaim({ key, owner: result.thread.id });
            releaseAttachments(input.files);
          },
          onError: (error) => {
            // Nothing was written — the server refuses the whole thread when the
            // upload fails — so the composer comes back holding exactly what it
            // held, at the selection it was opened on (UI-111). Losing a
            // screenshot to a refused post is the failure this prevents; losing
            // the sentence beside it was the same bug, unreported. The lane it
            // was addressed to comes back for a third reason: a `422` refusing
            // the pick means this build's roster is behind, and a retry that
            // fell back to the computed default would silently address somebody
            // else (UI-118).
            setDraft({
              ...source,
              restore: {
                text: input.body,
                attachments: input.files,
                recipient: restoredRecipient(input.stated, error),
              },
            });
          },
        },
      );
    },
    [createThread, docId],
  );

  const pendingDraft = useRef<{ source: CommentDraft; key: string | null } | null>(null);

  const submitComment = useCallback(
    (
      text: string,
      requestsAgent: boolean,
      stated: { readonly weight?: string; readonly recipient?: string },
      attachments: readonly PendingAttachment[] = [],
    ) => {
      if (draft === null) return;
      // The highlight is already up and stays up — sending is not a new mark,
      // it is the same one changing hands. Its key is what this response will
      // clear on success, and only if a later opening has not taken it over.
      const key = provisional?.key ?? null;
      // Re-opening on a refusal must not re-open holding the failed send's
      // leftovers as well as its own.
      const { restore: _spent, ...source } = draft;
      setDraft(null);
      const job: CommentPost = { body: text, requestsAgent, stated, files: attachments };
      if (editing) {
        queued.current = job;
        pendingDraft.current = { source, key };
        return;
      }
      post(job, source, key);
    },
    [draft, editing, post, provisional],
  );

  useEffect(() => {
    if (editing) return;
    const job = queued.current;
    const target = pendingDraft.current;
    if (job === null || target === null) return;
    queued.current = null;
    pendingDraft.current = null;
    post(job, target.source, target.key);
  }, [editing, post]);

  /**
   * Abandoned: the composer goes and the mark goes with it, leaving nothing
   * behind (UI-112's acceptance criterion). The words were never quoted
   * anywhere, so there is nothing for the highlight to have been about.
   */
  const cancelComment = useCallback(() => {
    setDraft(null);
    setProvisional(null);
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
    effectiveAnchors: effective,
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
