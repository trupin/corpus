import type { Doc, DocRow } from "@corpus/contract";
import {
  docWeightScope,
  hasSeenMark,
  isPendingTurn,
  MarkdownView,
  THREAD_DOC_TYPE,
  useDoc,
  useDocs,
  type RowNotice,
} from "@corpus/kit";
import type { RevealTarget } from "@corpus/kit/plugin";
import { useRef, type ReactElement } from "react";
import { AnchorChips, DetachedThreads, MarginColumn } from "../anchors/AnchoredThreads";
import { CommentPopover } from "../anchors/CommentPopover";
import { useAnchorLayer } from "../anchors/useAnchorLayer";
import { useMarginLayout } from "../anchors/useMarginLayout";
import { DocEditor, editorHandlesType } from "../editor/DocEditor";
import { useSelectionContextMenu } from "../menu/useSelectionContextMenu";
import { usePluginDiscovery, usePluginRegistry } from "../plugins/registry";
import { resolveDocPanel, resolveDocView } from "../plugins/slots";
import { summaryFromRow, type ThreadSummary } from "../thread/CollapsedThread";
import { ThreadPanel } from "../thread/ThreadPanel";
import { readStateOf, type ThreadReadState } from "../thread/threadCollapse";
import { Backlinks } from "./Backlinks";
import { FrontmatterForm } from "./FrontmatterForm";
import { RelatedPanel } from "./RelatedPanel";
import type { ReaderDoc } from "./useReaderDoc";

/**
 * **The** document view. One component, two hosts (SPEC.md §11).
 *
 * The in-column reader and focus mode differ in chrome and in reading measure
 * and in nothing else: same frontmatter form, same ⋯ menu, same 💬, same refs,
 * same backlinks, same related panel. Forking the rendering would let the two
 * drift, and §11 describes one document view rendered at two sizes.
 *
 * The body branch is where UI-006 landed: a markdown-bodied document renders
 * through `DocEditor`, and **there is no second branch** — §11's *the board is
 * never read-only* means a document the agent is writing gets the same editable
 * surface as any other. The lock banner that used to sit above it, and the
 * read-only rendering it announced, are gone with the mechanism (SPEC.md §7).
 *
 * **Three outcomes, decided in this order** (UI-014):
 *
 * 1. a thread is its conversation (`ThreadCard`) — SPEC.md §6;
 * 2. a plugin `View` registered for the document's type replaces the standard
 *    document view wholesale — SPEC.md §10;
 * 3. everything else is a markdown body, and a markdown body is editable —
 *    SPEC.md §11. Core type or plugin type, known or unknown, plugin present
 *    or long deleted.
 *
 * `MarkdownView` is left with exactly one document: a `view`, whose content is
 * its stored query rather than its prose.
 */

/**
 * Whether a thread that **is** the open document holds a turn nobody has seen —
 * and, where this reader cannot tell, saying so (PR #25 re-review, MAJOR).
 *
 * §11's interlock — "a conversation carrying a turn you have not seen is never
 * collapsed by the rule" — is the clause that stops the by-rule fold becoming a
 * way to lose messages, so this placement has to answer it truthfully rather
 * than assume. Three answers, from two sources:
 *
 * - **The thread's own row** is the server's answer, and the one every other
 *   placement reads (`summaryFromRow`). A thread opened as a document is handed
 *   no row, so it is looked up in its parent's thread list — the same
 *   `useDocs({parent, type: thread})` the reader that opened it already issued,
 *   under the same cache key.
 * - **What this browser has displayed**, when there is no row to find: a
 *   standalone thread has no parent to list (`useCompose` creates one on every
 *   Ask from the global composer), and a thread past the first page of a busy
 *   parent is not in the answer. `hasSeenMark` is the kit's record of the
 *   `POST …/seen` **this tab** sent for a `(thread, last turn)` pair. It is a
 *   module-level `Map` with a page session's lifetime, while read state is the
 *   server's and "survives browser changes" (§7) — so it can confirm a read and
 *   can never deny one.
 *
 * That asymmetry is the whole change here. The mark answers `read`; its absence
 * used to answer `unread`, which is this tab reporting a conversation the server
 * knows was read as carrying something unseen — and `ThreadPanel` latches a
 * placement, so a resolved standalone thread opened after a reload was placed
 * expanded every time, forever, against §6. Its absence now answers `unknown`,
 * the rule stands down rather than being fed a guess, and the placement is the
 * same one §11's interlock would have chosen — but for a reason the code can
 * defend. A field on the thread resource deletes this branch outright:
 * `issues/contract/036-thread-unread-field.md`.
 *
 * A conversation with no confirmed turn cannot be unread: there is nothing to
 * have read, exactly as `useMarkSeenOnce` treats it, and that is knowledge
 * rather than a guess.
 */
export function openThreadReadState(
  threadId: string,
  thread: ReaderDoc["thread"],
  row: DocRow | undefined,
): ThreadReadState {
  if (row !== undefined) return readStateOf(row.unread);
  const lastConfirmedTs = thread?.turns.findLast((turn) => !isPendingTurn(turn))?.ts;
  if (lastConfirmedTs === undefined) return "read";
  return hasSeenMark(threadId, lastConfirmedTs) ? "read" : "unknown";
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
}

export function DocView({
  reader,
  selectTitle,
  flashThread,
  onNavigate,
  onNotify,
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
   * The thread list this document's own row would be in, if it has one.
   *
   * For a thread with a parent that is the parent's list — the very query the
   * reader showing that parent issues, so this shares its cache entry rather
   * than adding a request. For everything else it is *this* document's own
   * thread list, which `useReaderDoc` has already fetched: the same key again,
   * and a list in which the document itself can never appear, so the lookup
   * below correctly finds nothing. That is what keeps the hook unconditional
   * without ever spending a request on a question this reader is not asking.
   */
  const rowScope = reader.isThread ? (reader.thread?.parent ?? reader.docId) : reader.docId;
  const scopeThreads = useDocs({ parent: rowScope, type: THREAD_DOC_TYPE });
  const openThreadRow = scopeThreads.data?.items.find((row) => row.id === reader.docId);
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
   * way. Same instinct as the plugin-discovery gate below: nothing paints until
   * what it would paint is known.
   */
  const placementKnown = !reader.threadPending && !scopeThreads.isPending;
  // Subscribe to plugin discovery so an open reader swaps to a plugin `View`
  // (or back) when the registry settles after first render.
  usePluginRegistry();
  const discovery = usePluginDiscovery();

  /**
   * The document, if any, whose body this reader is *currently showing* and
   * painted while discovery was `abandoned` — see the gate below. Its body is on
   * screen with no plugin chrome and must not acquire any: a panel appearing
   * over it now is the defect, arriving late instead of early. Written during
   * render because it is a cache of a render's own outcome and re-deriving it in
   * an effect would cost the frame this exists to prevent; the write is
   * idempotent.
   *
   * The mark is dropped the moment the reader moves onto another document,
   * which is what makes it a property of one painted body rather than of this
   * component (PR #22 review, MINOR). `DocView` is not keyed by document id, so
   * a reader lives across every navigation in its stack: a mark kept past the
   * document it describes would paint blind for a `[[ref]]` followed an hour
   * after discovery settled, and again for the original document on the way
   * Back — neither of which is a late arrival over anything. There is nothing on
   * screen at that point to protect; the incoming body's first paint carries its
   * chrome, which is exactly the ordering this whole gate is for.
   */
  const paintedBlind = useRef<string | null>(null);
  if (paintedBlind.current !== reader.docId) paintedBlind.current = null;
  if (doc !== undefined && discovery === "abandoned") paintedBlind.current = reader.docId;
  const blind = paintedBlind.current === reader.docId;

  // The PLUGINS-001 slots, resolved once per render. A registered plugin
  // `View` replaces the standard document view — including the editor, were a
  // plugin ever to claim a core editable type (SPEC.md §10: "a doc whose
  // `type` has a registered `View` renders with it") — so the anchor layer is
  // not hosted either: the plugin owns its whole body surface.
  const PluginView =
    doc === undefined || reader.isThread || blind ? null : resolveDocView(doc.frontmatter.type);
  const DocPanel =
    doc === undefined || reader.isThread || blind ? null : resolveDocPanel(doc.frontmatter.type);
  const anchorsHost =
    doc !== undefined &&
    !reader.isThread &&
    PluginView === null &&
    editorHandlesType(doc.frontmatter.type);
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
   * complete rendering of the same conversations: SPEC.md §11 says child threads
   * are shown per-turn, and reserves the below-body list for threads with **no
   * place in the body**.
   *
   * `reader.isThread` would fix the count and describe the wrong property. Two
   * body branches place threads and two do not, and what separates them is
   * whether they place, not what type the document is: the editor puts anchored
   * threads at their anchors, a thread's conversation puts its children under
   * their turns, while a plugin `View` and the static markdown fallback place
   * nothing at all — which is why the list is load-bearing there and must not be
   * removed with the duplicate. Naming the property the branches actually share
   * is what makes the next body branch answer the question rather than inherit
   * an answer.
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
    editable: anchorsHost,
    flashThread,
    onNotify,
  });

  /**
   * SPEC.md §11's selection menu, hosted here rather than on the reader: this
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

  useMarginLayout({
    main: anchors.mainRef,
    margin: anchors.marginRef,
    active: anchors.marginMode,
    threadIds: anchors.anchored.map((thread) => thread.threadId),
  });

  if (reader.isMissing) {
    return (
      <div className="reader-gone" role="status">
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
      <div className="reader-gone" role="alert">
        <p className="col-card-title">This document could not be read</p>
        <p className="col-card-body">{reader.error.message}</p>
      </div>
    );
  }

  /**
   * **Nothing of this document paints until plugin discovery has settled**
   * (UI-073) — and that is the whole fix, made here because this is where the
   * document's vertical layout is decided.
   *
   * Discovery is a dynamic `import()` started at bootstrap, and the `DocPanel`
   * it may register renders *above* the body. Landing after the editor had
   * painted, it dropped everything below it by its own height — measured at
   * **77.86px** (306.69 → 384.55) in the todos workspace. That is not cosmetic.
   * This is the surface where text is selected in order to comment on it, so a
   * body that moves between mousedown and mouseup yields a selection over words
   * nobody chose — silently, because the resulting selection is perfectly
   * valid. Driven deterministically, a drag aimed at `Call the plumber` came
   * back holding `in the inbox.` plus the whole item above it, and in UI-071 a
   * string picked up that way travelled into a comment quote and a highlight.
   *
   * **Why holding, and not the two alternatives.**
   *
   * - *Reserving the slot's height* would spend vertical space on every
   *   document in the workspace to protect a slot almost none of them fill,
   *   which SPEC.md §11's reading surface cannot afford and the issue rules
   *   out outright. The height is also unknowable before the panel renders (the
   *   todos panel grows a notice and a due chip), so the reservation would be a
   *   guess that still moves when it is wrong. And it cannot cover a plugin
   *   `View` at all: a `View` replaces the body wholesale, at whatever size it
   *   likes — there is no slot to reserve.
   * - *Cancelling an in-flight selection* when the layout shifts treats the
   *   symptom and misses half of it: a plain **click** — placing a caret,
   *   ticking a task-list box — has no in-flight state to cancel and still
   *   lands on whatever moved into its place.
   *
   * **What holding costs: bounded, and in practice nothing.** The registry goes
   * empty → loaded exactly once per session, from `main.tsx` at bootstrap, so
   * this is not a per-open price; and the wait it adds is only whatever is left
   * of a local module import once the reader's own `GET /api/docs/:id` round
   * trip is done. Every reader opened after that first settle waits for zero.
   * Core's boot stays uncoupled from plugin load time — the shell, the board and
   * the keyboard are live from the first frame (§10's containment promise);
   * only the one surface whose geometry is at risk waits, and it says so.
   *
   * **The bound.** `DISCOVERY_BUDGET_MS` (2s) — past that the phase turns
   * `abandoned` and the body paints with no plugin chrome, because an unreadable
   * document is worse than an unadorned one. `blind` above then holds this
   * document that way for as long as it is on screen, so a registry that turns
   * up afterwards is honoured by the next document opened rather than by moving
   * the words out from under a pointer that is already on them.
   */
  if (doc === undefined || discovery === "pending") {
    return <p className="reader-note">Loading…</p>;
  }

  return (
    <>
      <div
        className="doc-main"
        ref={anchors.mainRef}
        onContextMenu={selectionMenu}
        /*
         * A plugin `View` owns its whole body surface (SPEC.md §10), so core
         * paints no menu of its own over it — the plugin contributes one if it
         * wants one (§11, amended 2026-08-02). The marker is what
         * `menu/nativeMenu.ts` reads, so
         * the reader's own right-click handler never has to know about plugins.
         */
        {...(PluginView === null ? {} : { "data-plugin-surface": "" })}
      >
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
         * The DocPanel slot — the one core injection slot in v1 (SPEC.md §10):
         * for a doc type a plugin owns, its panel renders in this fixed spot
         * above the document body. Both hosts get it for free, because the
         * column reader and focus mode both render this component. The
         * resolver returns the panel already wrapped in its own boundary, or
         * `null` — no plugin, no panel, **no placeholder**: a document nothing
         * claims lays out exactly as it did before there was a slot here. The
         * gate above is what makes that affordable — nothing below this line
         * ever moves to make room, because nothing below it paints first.
         */}
        {DocPanel !== null ? <DocPanel doc={doc} /> : null}

        {/*
         * The one body-rendering call site. A thread document's body IS its
         * conversation (SPEC.md §6: "the conversation is the document"), which is
         * why a thread opened from a column reads as turns rather than as the
         * markdown file behind them. A plugin `View` replaces the standard
         * document view wholesale for its registered type (SPEC.md §10).
         *
         * With no plugin, a non-core type falls through to the **editor**, not
         * to a static render (UI-014): §10's deleted-plugin degradation is the
         * loss of the plugin's chrome, and §15 M6's "renders as plain markdown"
         * is satisfied by the plain-markdown body the editor shows — which the
         * user can still fix, as they can on every other document.
         */}
        {reader.isThread ? (
          <div className="doc-body thread-conversation">
            {/*
             * The conversation you opened — placed by the same rule as every
             * other placement (PR #25 review, MAJOR).
             *
             * This panel used to opt out of the rule, on the reading that
             * navigating to a thread is newer than the rule and therefore wins
             * §11's precedence. It is not: §11's precedence clause is about
             * "collapsing or expanding it **yourself**", an explicit gesture,
             * while the rule applies "when a conversation is **placed**" — and
             * opening a thread in a reader is a placement. §6 settles the rest
             * in one line, "a resolved thread is collapsed by default *wherever
             * it is shown*", and §11 enumerates this placement by name. The
             * exception also broke the half of §11 that is not open to reading
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
                  openThreadReadState(reader.docId, reader.thread, openThreadRow),
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
        ) : PluginView !== null ? (
          <PluginView doc={doc} />
        ) : (
          <MarkdownView markdown={doc.body} className="doc-body" onOpenRef={onNavigate} />
        )}

        {/*
         * Anchored threads sit at their anchors (a chip between two blocks, or a
         * card in the margin); only the ones with no place in the body are listed
         * here — never anchored, orphaned, or anchored somewhere this view cannot
         * point at (`anchorPlacement.segmentsOf`).
         */}
        {anchorsHost ? (
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
         * A plugin `View` and the static markdown fallback host no anchor layer
         * and no conversation, so for them this is the only render their threads
         * ever get: the branch is load-bearing and removing it would silently
         * drop every thread on those documents. A thread reaches this line with
         * its children already placed per turn (SPEC.md §11), so it lists
         * nothing — and a child whose anchor went orphaned is not lost with the
         * list, because `placeChildThreads` has already put it after the last
         * turn rather than leaving it for this one.
         */}
        {bodyPlacesThreads || reader.threads.length === 0 ? null : (
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

      {anchors.marginMode ? (
        <MarginColumn
          threads={anchors.anchored}
          parentId={doc.frontmatter.id}
          flashThread={flashThread}
          onOpenDoc={onNavigate}
          onNotify={onNotify}
          innerRef={anchors.marginRef}
        />
      ) : null}

      {anchors.draft === null ? null : (
        <CommentPopover
          quote={anchors.draft.selection.selector.exact}
          top={anchors.draft.top}
          left={anchors.draft.left}
          pending={anchors.submitting}
          // A comment on a document selection is not yet in a conversation, so
          // the nearest scope §11's rule can mean is the document itself.
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
