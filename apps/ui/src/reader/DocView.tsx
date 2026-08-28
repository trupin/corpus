import type { Doc } from "@corpus/contract";
import {
  docWeightScope,
  MarkdownView,
  useDoc,
  type RevealTarget,
  type RowNotice,
} from "@corpus/kit";
import { useEffect, type ReactElement } from "react";
import type { Editor } from "@tiptap/react";
import { AnchorChips, DetachedThreads, MarginColumn } from "../anchors/AnchoredThreads";
import { CommentPopover } from "../anchors/CommentPopover";
import { CommentsTab } from "../comments/CommentsTab";
import type { ReaderTab } from "../comments/CommentsSwitch";
import type { CommentFilters } from "../comments/commentsModel";
import { useAnchorLayer } from "../anchors/useAnchorLayer";
import { useMarginLayout } from "../anchors/useMarginLayout";
import { DocEditor, editorHandlesType } from "../editor/DocEditor";
import { useSelectionContextMenu } from "../menu/useSelectionContextMenu";
import { summaryFromRow, type ThreadSummary } from "../thread/CollapsedThread";
import { ThreadPanel } from "../thread/ThreadPanel";
import { readStateOf, type ThreadReadState } from "../thread/threadCollapse";
import { Backlinks } from "./Backlinks";
import { BoardFrontmatter } from "./BoardFrontmatter";
import { DocWidthHandle } from "./DocWidthContext";
import { FrontmatterForm } from "./FrontmatterForm";
import { RelatedPanel } from "./RelatedPanel";
import { REVEAL_SETTLED_ATTRIBUTE } from "./reveal";
import { ScopeProvenance } from "./ScopeProvenance";
import type { ReaderDoc } from "./useReaderDoc";

/**
 * **The** document view. One component, two hosts (SPEC.md §10).
 *
 * The in-column reader and focus mode differ in chrome and in reading measure
 * and in nothing else: same frontmatter form, same ⋯ menu, same 💬, same refs,
 * same backlinks, same related panel. Forking the rendering would let the two
 * drift, and §10 describes one document view rendered at two sizes.
 *
 * The body branch is where UI-006 landed: a markdown-bodied document renders
 * through `DocEditor`, and **there is no second branch** — §10's *the board is
 * never read-only* means a document the agent is writing gets the same editable
 * surface as any other. The lock banner that used to sit above it, and the
 * read-only rendering it announced, are gone with the mechanism (SPEC.md §7).
 *
 * **Two outcomes, decided in this order** (UI-014):
 *
 * 1. a thread is its conversation (`ThreadCard`) — SPEC.md §6;
 * 2. everything else is a markdown body, and a markdown body is editable —
 *    SPEC.md §10, which says a core type and "a type nothing recognises" open
 *    alike. That second clause is the whole of what protects a workspace's
 *    existing documents: this build knows six types and will meet files typed
 *    for a seventh, and they get the ordinary document view — editor, working
 *    checkboxes, comments, search — rather than a placeholder or a refusal.
 *
 * **There is no third outcome, and no seam for one.** Nothing registers a
 * surface of its own for a document type, so those two branches are the whole of
 * what a document can open as, and the rule above has no exception.
 *
 * `MarkdownView` is left with exactly one document: a `view`, whose content is
 * its stored query rather than its prose.
 */

/**
 * Whether a thread that **is** the open document holds a turn nobody has seen.
 *
 * §10's interlock — "a conversation carrying a turn you have not seen is never
 * collapsed by the rule" — is the clause that stops the by-rule fold becoming a
 * way to lose messages, so this placement has to answer it truthfully rather
 * than assume. **`Thread.unread` is the server's answer** (CONTRACT-036), and it
 * is the same comparison `DocRow.unread` publishes, so a thread cannot disagree
 * with its own row.
 *
 * **What this replaced, and the bug that went with it.** There used to be no
 * field, so this asked two other sources: the thread's row, looked up in its
 * parent's `useDocs({parent, type: thread})` list, and — where there was no row
 * to find — `hasSeenMark`, the kit's record of the `POST …/seen` *this tab*
 * sent. A standalone thread has no parent to list, so it always fell to the
 * mark, and the mark is a module-level `Map` with a page session's lifetime
 * while read state is the server's and "survives browser changes" (§7). It could
 * confirm a read and could never deny one, so it answered `read` or `unknown`,
 * and `unknown` stands the by-rule fold down. The behaviour that left: **a
 * resolved standalone thread opened expanded on its first visit after every
 * reload**, however long ago it was read, against §6's "collapsed by default
 * wherever it is shown". For that placement it was collapsed by default only
 * from the second visit of a browser session.
 *
 * A conversation with no turns at all still cannot be unread — there is nothing
 * to have read — but that is now the server's arithmetic rather than this
 * function's, and {@link readStateOf} carries the in-flight case: a read that
 * has not landed answers `unknown`, and {@link DocView} does not place the
 * conversation until it has.
 */
export function openThreadReadState(thread: ReaderDoc["thread"]): ThreadReadState {
  return readStateOf(thread?.unread);
}

/**
 * The summary for a thread that **is** the open document.
 *
 * Every other placement gets one from the projection's row (`summaryFromRow`);
 * this one has no row, because the reader opened a document rather than picked
 * an item out of a list. So it is assembled from what the reader already holds —
 * the conversation itself, for the turn count and the status — plus the parent's
 * resolved anchor for the quote, which is the only place a thread's anchored
 * words exist (the selector lives in the *parent's* frontmatter, SPEC.md §6) —
 * and {@link openThreadReadState} for the one field neither of those carries.
 *
 * Both reads are already in flight for this document: `useReaderDoc` fetches the
 * conversation, and the expanded card fetches the parent under the same cache
 * key. Nothing here costs a request that was not going to be made.
 */
export function openThreadSummary(
  threadId: string,
  thread: ReaderDoc["thread"],
  parent: Doc | undefined,
  readState: ThreadReadState,
): ThreadSummary {
  return {
    id: threadId,
    status: thread?.status ?? "open",
    turnCount: thread?.turns.length ?? 0,
    lastAuthor: thread?.turns.at(-1)?.author ?? null,
    readState,
    quote:
      parent?.anchors.find((anchor) => anchor.threadId === threadId)?.selector.exact.trim() ?? "",
    parent: thread?.parent ?? null,
    parentTitle: parent?.frontmatter.title ?? null,
  };
}

export interface DocViewProps {
  readonly reader: ReaderDoc;
  /** True right after creation: the title is focused *and* selected. */
  readonly selectTitle: boolean;
  /** The thread the 💬 popover just jumped to; flashes for ~1.2s. */
  readonly flashThread: string | null;
  /**
   * A `[[ref]]`, a backlink or a thread-context link was followed.
   *
   * The optional `reveal` rides onto the navigation entry the host pushes, so a
   * follow can name **where inside** the arriving document to land (UI-095).
   * A `[[ref]]` names a document and omits it; a thread-context link names the
   * conversation it came from and passes it.
   */
  readonly onNavigate: (docId: string, reveal?: RevealTarget) => void;
  readonly onNotify: (notice: RowNotice) => void;
  /**
   * Which half of the reader the header's switch is on (SPEC.md §10's rider).
   *
   * The two are **alternatives, not layers**: the body is unmounted while the
   * comments list is shown. §7 counts *displayed* content, and a `ThreadCard`
   * kept mounted behind a hidden body would mark conversations seen that nobody
   * looked at — so the list replaces the body rather than covering it. The cost
   * is the editor's remount when the switch flips back, which flushes the
   * pending save exactly as a navigation does.
   */
  readonly tab: ReaderTab;
  readonly filters: CommentFilters;
  readonly onFilters: (filters: CommentFilters) => void;
  /** Back to the document, then reveal this conversation at its anchor (UI-037). */
  readonly onReveal: (threadId: string) => void;
  /**
   * The live editor, republished for a host that draws chrome around it.
   *
   * Focus mode's formatting toolbar (UI-101) is above this component rather than
   * inside it, and it needs the instance to report what the text already is.
   * `null` is not an absence to work around — it is the gate: no editor is
   * mounted for a `thread`, for a `view`, or while the comments list is showing,
   * so a host that has none renders no toolbar and needs no predicate of its own.
   */
  readonly onEditor?: ((editor: Editor | null) => void) | undefined;
}

export function DocView({
  reader,
  selectTitle,
  flashThread,
  tab,
  filters,
  onFilters,
  onReveal,
  onNavigate,
  onNotify,
  onEditor,
}: DocViewProps): ReactElement {
  const { doc } = reader;
  /*
   * The parent of a thread that is itself the open document — where its anchored
   * words live (SPEC.md §6). Disabled on anything that is not a thread, and on a
   * standalone one, which has no parent to ask about.
   */
  const openThreadParent = useDoc(
    reader.isThread ? (reader.thread?.parent ?? undefined) : undefined,
  );
  /**
   * Whether this reader yet knows how to **place** the conversation it opened.
   *
   * The rule decides the state a conversation is placed in, once, and a fold
   * taken on a guess does not correct itself: the panel latches what it was
   * placed with until the status changes, precisely so that reading a
   * conversation cannot fold it (`ThreadCollapseApi.place`). So the two facts
   * the rule reads — the thread's status, and whether it holds an unseen turn —
   * have to be in hand *before* the panel mounts, or a resolved conversation is
   * placed open whenever its row is a beat slower than its turns and stays that
   * way. Nothing paints until what it would paint is known.
   *
   * One read, not two, since CONTRACT-036: both facts are fields of the
   * conversation itself. This used to also wait on the parent's thread list,
   * because that list was where {@link openThreadReadState} went looking for a
   * row — and a standalone thread has no parent, so for the placement that was
   * actually wrong the list could never answer at all.
   */
  const placementKnown = !reader.threadPending;
  /**
   * Whether this reader hosts the anchor layer — the editable body, and the only
   * branch below that puts conversations at their anchors.
   *
   * A thread is its own conversation and hosts none. Everything else does, for
   * every type `editorHandlesType` answers for — which is every type but `view`,
   * including one this build has never heard of. There is no second gate:
   * nothing claims a type ahead of that predicate, so its answer is the answer
   * here too.
   */
  const anchorsHost =
    doc !== undefined && !reader.isThread && editorHandlesType(doc.frontmatter.type);
  /**
   * Whether the document half is the one being shown.
   *
   * Every placement the body owns — the editor, the chips at their anchors, the
   * margin column, the below-body list, backlinks and related — is gated on
   * this, and so is the anchor layer's `editable`. Two reasons, and the second
   * is the one that would have bitten: a conversation is listed in the comments
   * tab *and* placed at its anchor, so leaving the anchored placements mounted
   * would put two `ThreadPanel`s for one conversation on one screen, each
   * marking it seen and each holding its own fold.
   */
  const showsBody = tab === "document";
  /**
   * Whether the body branch below has **already placed this document's threads**
   * (UI-087).
   *
   * Not the same question as `anchorsHost`, and that conflation is the defect:
   * the below-body list was written as the `anchorsHost` false branch, on the
   * reading that a body with no anchor layer is a body that places nothing. That
   * held when it was written and stopped holding when child threads gained
   * per-turn placement — a thread has no anchor layer either, yet `ThreadCard`
   * places **every** child it has, `placeChildThreads` splitting them into the
   * ones under their turn and the ones after the last turn, two sets that are
   * exhaustive and mutually exclusive. So the list below it was a second,
   * complete rendering of the same conversations: SPEC.md §10 says child threads
   * are shown per-turn, and reserves the below-body list for threads with **no
   * place in the body**.
   *
   * `reader.isThread` would fix the count and describe the wrong property. Two
   * body branches place threads and one does not, and what separates them is
   * whether they place, not what type the document is: the editor puts anchored
   * threads at their anchors, a thread's conversation puts its children under
   * their turns, while the static markdown fallback places nothing at all —
   * which is why the list is load-bearing there and must not be removed with the
   * duplicate. Naming the property the branches actually share is what makes the
   * next body branch answer the question rather than inherit an answer.
   */
  const bodyPlacesThreads = anchorsHost || reader.isThread;

  /*
   * Hooks run before the early returns below, so the layer is asked about a
   * document that may not have arrived yet — which is why it takes the body and
   * the anchors rather than the reader, and answers about nothing when there is
   * nothing.
   */
  const anchors = useAnchorLayer({
    docId: reader.docId,
    body: doc?.body ?? "",
    anchors: doc?.anchors ?? [],
    threads: reader.threads,
    threadsSettled: reader.threadsSettled,
    // False while the comments list is showing: with no editor mounted there is
    // nothing to select, nothing to comment on, and no body for the margin to
    // measure itself against.
    editable: anchorsHost && showsBody,
    flashThread,
    onNotify,
  });

  /**
   * SPEC.md §10's selection menu, hosted here rather than on the reader: this
   * is the component both hosts render, and it is where the editor and the
   * commenting flow already meet. It declines every event it does not own, so
   * the reader's own right-click (the document's ⋯ set) still reaches every
   * other part of the surface.
   */
  const selectionMenu = useSelectionContextMenu({
    editor: anchors.editor,
    captureComment: anchors.captureComment,
    onNotify,
  });

  /*
   * The editor, handed to whatever chrome the host draws around this component
   * (UI-101). An effect rather than a render-time call: publishing during render
   * would set a parent's state while a child is rendering.
   */
  useEffect(() => {
    onEditor?.(anchors.editor);
    return () => {
      onEditor?.(null);
    };
  }, [anchors.editor, onEditor]);

  useMarginLayout({
    main: anchors.mainRef,
    margin: anchors.marginRef,
    active: anchors.marginMode,
    threadIds: anchors.anchored.map((thread) => thread.threadId),
  });

  /**
   * The three renders below are this reader's whole vocabulary, and exactly two
   * of them are somewhere it has *arrived*. A reveal has to tell them apart —
   * "the quote is not on this document" and "the document has not rendered yet"
   * are its two ways of failing, and only the surface knows which — so the two
   * terminal renders say so and the `Loading…` one deliberately does not.
   * `reveal.ts`'s {@link REVEAL_SETTLED_ATTRIBUTE} is where that contract, and
   * the reason it is declared rather than guessed at, is written down.
   */
  const arrived = { [REVEAL_SETTLED_ATTRIBUTE]: "" };

  if (reader.isMissing) {
    return (
      <div className="reader-gone" role="status" {...arrived}>
        <p className="col-card-title">This document no longer exists</p>
        <p className="col-card-body">
          {reader.docId} was deleted. Its history is still in git — nothing was lost from the
          record. Use Back to leave.
        </p>
      </div>
    );
  }

  if (reader.error !== null) {
    return (
      <div className="reader-gone" role="alert" {...arrived}>
        <p className="col-card-title">This document could not be read</p>
        <p className="col-card-body">{reader.error.message}</p>
      </div>
    );
  }

  /**
   * `Loading…` until the document itself has arrived, and nothing else gates it.
   *
   * **One gate is the whole of it, and the hazard that bought the second one
   * belongs to whatever is added above the body next** (UI-073). A panel that
   * renders above the body and lands *after* the editor has painted drops
   * everything below it by its own height — the last such panel this reader
   * carried measured **77.86px** (306.69 → 384.55). This is the surface where
   * text is selected in order to comment on it, so a body that moves between
   * mousedown and mouseup
   * yields a selection over words nobody chose — silently, because the resulting
   * selection is perfectly valid. Driven deterministically, a drag aimed at one
   * list item came back holding a phrase from the item above it, and in UI-071 a
   * string picked up that way travelled into a comment quote and a highlight. A
   * plain **click** is not covered by cancelling an in-flight selection either:
   * placing a caret or ticking a task-list box has no in-flight state to cancel
   * and still lands on whatever moved into its place. So anything that renders
   * above the body must be laid out in the body's first paint, not after it —
   * which is what every remaining child here does.
   */
  if (doc === undefined) {
    return <p className="reader-note">Loading…</p>;
  }

  return (
    <>
      <div
        className="doc-main"
        ref={anchors.mainRef}
        onContextMenu={selectionMenu}
        // Arrived: the body is on screen, and a reveal that cannot find its
        // words in it has found them absent rather than early (see above).
        {...arrived}
      >
        {/*
         * The body's own right edge, as a grab handle — in **full screen
         * only** (SPEC.md §10, rider signed 2026-08-23): a column's body fills
         * the column, so the column's edge is the single gesture there and this
         * draws nothing (`DocWidthContext` is `null` — the column reader and a
         * `DocView` in a component test alike provide none). First in the
         * document half so it is one Tab from the head rather than one Tab past
         * the whole editor, and rendered only while a body is on screen: the
         * comments list carries no measure, and a control that visibly does
         * nothing is worse than no control.
         */}
        {showsBody ? <DocWidthHandle conversation={reader.isThread} /> : null}

        <FrontmatterForm
          /*
           * Keyed by document id, exactly as `DocEditor` is: a navigation is a
           * remount, which is what flushes the outgoing document's unsaved
           * frontmatter before the form rebinds — and what stops an uncommitted
           * title leaking onto the document that took its place. The prefix keeps
           * it distinct from the editor's key: they are siblings, and React
           * requires sibling keys to differ.
           */
          key={`frontmatter:${doc.frontmatter.id}`}
          doc={doc}
          selectTitle={selectTitle}
          onNotify={onNotify}
          banner={
            <>
              {reader.isArchived ? (
                <div className="archived-banner" role="status">
                  This document is <b>archived</b> — it is hidden from default lists. Archiving is
                  reversible; set its status back to open to restore it.
                </div>
              ) : null}
            </>
          }
        />

        {/*
         * SPEC.md §7's scope, on the artifact: which conversation this document
         * came out of, and who is resident in it. Above the body because it is
         * context for reading it, and quiet enough that a
         * document belonging to no conversation — the ordinary case — looks
         * exactly as it did before (`ScopeProvenance` draws nothing at all).
         */}
        <ScopeProvenance docId={doc.frontmatter.id} onOpenDoc={onNavigate} />

        {/*
         * A board document says what it is (SPEC.md §10, rider 2, UI-148). It
         * draws nothing at all on every other type.
         */}
        <BoardFrontmatter frontmatter={doc.frontmatter} />

        {/*
         * The comments list, in place of the body — SPEC.md §10's rider: *"the
         * trade the user accepted is seeing one or the other, not both"*.
         *
         * It is offered on every document, including one that is itself a
         * thread: a conversation can carry child threads, and "what is
         * outstanding here" is the same question whatever the document is made
         * of.
         */}
        {showsBody ? null : (
          <CommentsTab
            docId={doc.frontmatter.id}
            threads={reader.threads}
            /*
             * The **server's** verdict about the body as it stands, which is
             * what decides the anchored axis. `DocRow.anchorQuote` would not:
             * it is the stored selector's text and survives the anchor going
             * orphaned, so a list built on it files every orphan under
             * "anchored" — the one row the rider exists to surface.
             */
            anchors={doc.anchors}
            body={doc.body}
            filters={filters}
            onFilters={onFilters}
            flashThread={flashThread}
            onReveal={onReveal}
            onOpenDoc={onNavigate}
            onNotify={onNotify}
          />
        )}

        {/*
         * The document half.
         *
         * **The editor is hidden rather than unmounted** while the list is
         * showing, and the reason is the reveal seam. `useAnchorLayer`'s flash
         * effect expands a clipped changelog entry around the anchored highlight
         * and scrolls to it — once, in the commit that sets the flash — so a body
         * that mounts a beat later has nothing for it to find, and UI-089's clip
         * stayed shut on every reveal out of this list (caught by
         * `changelog.spec.ts`). Hiding costs nothing §7 protects: a document body
         * displays no conversation, and every placement that *does* — the chips at
         * their anchors, the margin, the below-body list — is unmounted below, so
         * nothing is marked seen behind a surface nobody is looking at.
         *
         * The wrapper is `display: contents`, so it is invisible to layout and the
         * body's own measure is untouched; `[hidden]` is what takes it off screen.
         * The other two body branches *do* place conversations — a thread's body
         * is its conversation, and the static fallback falls through to the thread
         * list below — so they are unmounted, and only the editor is kept.
         */}
        <div className="doc-body-slot" hidden={!showsBody}>
          {/*
           * The one body-rendering call site. A thread document's body IS its
           * conversation (SPEC.md §6: "the conversation is the document"), which is
           * why a thread opened from a column reads as turns rather than as the
           * markdown file behind them.
           *
           * **A type this build does not recognise falls through to the editor**,
           * not to a static render (UI-014, SPEC.md §12's M6). A workspace holds
           * whatever its owner and its
           * agent have written, `type:` is an open string on the wire (§5), and the
           * promise is that such a document opens, renders its markdown with
           * working checkboxes, is searchable and is commentable — the same
           * document view every core type gets. `MarkdownView` below is left with
           * exactly one type, `view`, whose content is its stored query.
           */}
          {!showsBody && !anchorsHost ? null : reader.isThread ? (
            <div className="doc-body thread-conversation">
              {/*
               * The conversation you opened — placed by the same rule as every
               * other placement (PR #25 review, MAJOR).
               *
               * This panel used to opt out of the rule, on the reading that
               * navigating to a thread is newer than the rule and therefore wins
               * §10's precedence. It is not: §10's precedence clause is about
               * "collapsing or expanding it **yourself**", an explicit gesture,
               * while the rule applies "when a conversation is **placed**" — and
               * opening a thread in a reader is a placement. §6 settles the rest
               * in one line, "a resolved thread is collapsed by default *wherever
               * it is shown*", and §10 enumerates this placement by name. The
               * exception also broke the half of §10 that is not open to reading
               * at all: "a change to the thread's status re-asserts the rule…
               * **so resolving a conversation collapses it even while it is open
               * on screen**", which resolving a thread-as-document did not do.
               */}
              {placementKnown ? (
                <ThreadPanel
                  summary={openThreadSummary(
                    reader.docId,
                    reader.thread,
                    openThreadParent.data,
                    openThreadReadState(reader.thread),
                  )}
                  host="standalone"
                  onOpenDoc={onNavigate}
                  onNotify={onNotify}
                />
              ) : (
                <p className="reader-note">Loading…</p>
              )}
            </div>
          ) : anchorsHost ? (
            /*
             * Keyed by document id: a navigation is a remount, which is what
             * flushes the outgoing document's pending save before the editor
             * rebinds. A rename, an SSE refresh or a key refused and re-presented
             * changes no key here, and therefore keeps the caret, the scroll and
             * the selection.
             */
            <DocEditor
              key={doc.frontmatter.id}
              docId={doc.frontmatter.id}
              body={doc.body}
              documentKey={doc.key}
              onOpenRef={onNavigate}
              onComment={anchors.onComment}
              onAnchors={anchors.onAnchors}
              onEditor={anchors.onEditor}
            />
          ) : (
            <MarkdownView markdown={doc.body} className="doc-body" onOpenRef={onNavigate} />
          )}

          {/*
           * Anchored threads sit at their anchors (a chip between two blocks, or a
           * card in the margin); only the ones with no place in the body are listed
           * here — never anchored, orphaned, or anchored somewhere this view cannot
           * point at (`anchorPlacement.segmentsOf`).
           */}
          {showsBody && anchorsHost ? (
            <>
              <AnchorChips
                threads={anchors.anchored}
                parentId={doc.frontmatter.id}
                flashThread={flashThread}
                onOpenDoc={onNavigate}
                onNotify={onNotify}
                hostFor={anchors.slotHost}
              />
              <DetachedThreads
                wholeDocument={anchors.wholeDocument}
                orphaned={anchors.orphaned}
                unplaced={anchors.unplaced}
                /*
                 * A detached comment is offered a way back only where the body it
                 * would attach to is on screen and in the coordinate space the
                 * server answers in — which is here, in the anchor layer's own
                 * host, and nowhere else (UI-086).
                 */
                reattach={{
                  docId: doc.frontmatter.id,
                  body: doc.body,
                  anchors: anchors.effectiveAnchors,
                }}
                flashThread={flashThread}
                onOpenDoc={onNavigate}
                onNotify={onNotify}
              />
            </>
          ) : null}

          {/*
           * And the threads **nothing above has placed** — the list UI-005 put
           * here, now asking the question it always meant (see
           * `bodyPlacesThreads`).
           *
           * The static markdown fallback — a `view` document — hosts no anchor
           * layer and no conversation, so for it this is the only render its
           * threads ever get: the branch is load-bearing and removing it would
           * silently drop every thread on one. A thread reaches this line with
           * its children already placed per turn (SPEC.md §10), so it lists
           * nothing — and a child whose anchor went orphaned is not lost with the
           * list, because `placeChildThreads` has already put it after the last
           * turn rather than leaving it for this one.
           */}
          {!showsBody || bodyPlacesThreads || reader.threads.length === 0 ? null : (
            <div className="thread-slots">
              {reader.threads.map((row) => (
                <ThreadPanel
                  key={row.id}
                  summary={summaryFromRow(row)}
                  host="slot"
                  flashing={flashThread === row.id}
                  onOpenDoc={onNavigate}
                  onNotify={onNotify}
                />
              ))}
            </div>
          )}

          <Backlinks backlinks={reader.backlinks} onOpen={onNavigate} />
          <RelatedPanel related={reader.related} onOpen={onNavigate} />
        </div>
      </div>

      {/* `editable` already turns the margin off when the list is showing, but
          it does so in an effect — one frame later. The gate is stated here too
          so the cards are never drawn beside a body that is not on screen. */}
      {showsBody && anchors.marginMode ? (
        <MarginColumn
          threads={anchors.anchored}
          parentId={doc.frontmatter.id}
          flashThread={flashThread}
          onOpenDoc={onNavigate}
          onNotify={onNotify}
          innerRef={anchors.marginRef}
        />
      ) : null}

      {!showsBody || anchors.draft === null ? null : (
        <CommentPopover
          quote={anchors.draft.selection.selector.exact}
          anchor={anchors.draft.anchor}
          pending={anchors.submitting}
          // A comment on a document selection is not yet in a conversation, so
          // the nearest scope §10's rule can mean is the document itself.
          weightScope={docWeightScope(doc.frontmatter.id)}
          // …and the scope walk starts at the same document: a comment on it is
          // a thread on it, which is exactly what §7's walk climbs from.
          recipientScope={doc.frontmatter.id}
          // Set only on a draft the layer re-opened after a refusal: the words
          // and the files the refused send was carrying (UI-111).
          restore={anchors.draft.restore}
          onSubmit={anchors.submitComment}
          onClose={anchors.cancelComment}
        />
      )}
    </>
  );
}
