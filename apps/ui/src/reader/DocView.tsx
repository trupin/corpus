import type { Lock } from "@corpus/contract";
import { MarkdownView, type RowNotice } from "@corpus/kit";
import { useRef, type ReactElement } from "react";
import { AnchorChips, DetachedThreads, MarginColumn } from "../anchors/AnchoredThreads";
import { CommentPopover } from "../anchors/CommentPopover";
import { useAnchorLayer } from "../anchors/useAnchorLayer";
import { useMarginLayout } from "../anchors/useMarginLayout";
import { DocEditor, editorHandlesType } from "../editor/DocEditor";
import { useSelectionContextMenu } from "../menu/useSelectionContextMenu";
import { usePluginDiscovery, usePluginRegistry } from "../plugins/registry";
import { resolveDocPanel, resolveDocView } from "../plugins/slots";
import { ThreadCard } from "../thread/ThreadCard";
import { Backlinks } from "./Backlinks";
import { FrontmatterForm } from "./FrontmatterForm";
import { LockBanner } from "./LockBanner";
import { RelatedPanel } from "./RelatedPanel";
import { ThreadSlot } from "./ThreadSlot";
import type { ReaderDoc } from "./useReaderDoc";

/**
 * **The** document view. One component, two hosts (SPEC.md §11).
 *
 * The in-column reader and focus mode differ in chrome and in reading measure
 * and in nothing else: same frontmatter form, same lock banner, same ⋯ menu,
 * same 💬, same refs, same backlinks, same related panel. Forking the rendering
 * would let the two
 * drift, and §11 describes one document view rendered at two sizes.
 *
 * The body branch is where UI-006 landed: a markdown-bodied document renders
 * through `DocEditor` — always, including when it is locked, which is the same
 * surface at `editable: false` rather than a second read-only renderer
 * (sprint-011 Adjudication 7).
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
 * The lock that makes this document read-only.
 *
 * A `user` lock is **this** session's own: the editor takes one on the first
 * keystroke so the agent's queue defers to it (SPEC.md §7), and treating it as
 * foreign would make the editor lock itself out and raise a banner announcing
 * the user to the user.
 */
export function foreignLock(lock: Lock | null): Lock | null {
  return lock === null || lock.holder === "user" ? null : lock;
}

export interface DocViewProps {
  readonly reader: ReaderDoc;
  /** True right after creation: the title is focused *and* selected. */
  readonly selectTitle: boolean;
  readonly expandedThreads: readonly string[];
  /** The thread the 💬 popover just jumped to; flashes for ~1.2s. */
  readonly flashThread: string | null;
  readonly onToggleThread: (threadId: string) => void;
  /** A `[[ref]]`, a backlink or a thread-context link was followed. */
  readonly onNavigate: (docId: string) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function DocView({
  reader,
  selectTitle,
  expandedThreads,
  flashThread,
  onToggleThread,
  onNavigate,
  onNotify,
}: DocViewProps): ReactElement {
  const { doc } = reader;
  const lock = foreignLock(reader.lock);
  // Subscribe to plugin discovery so an open reader swaps to a plugin `View`
  // (or back) when the registry settles after first render.
  usePluginRegistry();
  const discovery = usePluginDiscovery();

  /**
   * The document, if any, whose body this reader painted while discovery was
   * `abandoned` — see the gate below. Its body is on screen with no plugin
   * chrome and must not acquire any: a panel appearing over it now is the
   * defect, arriving late instead of early. Written during render because it is
   * a cache of a render's own outcome and re-deriving it in an effect would
   * cost the frame this exists to prevent; the write is idempotent.
   */
  const paintedBlind = useRef<string | null>(null);
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
    locked: lock !== null,
    editable: anchorsHost,
    expandedThreads,
    flashThread,
    onToggleThread,
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
          locked={lock !== null}
          onNotify={onNotify}
          banner={
            <>
              {lock === null ? null : <LockBanner lock={lock} onNotify={onNotify} />}
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
            <ThreadCard
              threadId={reader.docId}
              host="standalone"
              onOpenDoc={onNavigate}
              onNotify={onNotify}
            />
          </div>
        ) : anchorsHost ? (
          /*
           * Keyed by document id: a navigation is a remount, which is what
           * flushes the outgoing document's pending save before the editor
           * rebinds. A lock arriving, a rename or an SSE refresh changes no key
           * and therefore keeps the caret, the scroll and the selection.
           */
          <DocEditor
            key={doc.frontmatter.id}
            docId={doc.frontmatter.id}
            body={doc.body}
            locked={lock !== null}
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
         * point at (`anchorPlacement.segmentsOf`). A document the editor does not
         * own has no anchors to place, so every thread on it stays below the
         * body, where UI-005 put them.
         */}
        {anchorsHost ? (
          <>
            <AnchorChips
              threads={anchors.anchored}
              expandedThreads={expandedThreads}
              flashThread={flashThread}
              onToggleThread={onToggleThread}
              onOpenDoc={onNavigate}
              onNotify={onNotify}
              hostFor={anchors.slotHost}
            />
            <DetachedThreads
              wholeDocument={anchors.wholeDocument}
              orphaned={anchors.orphaned}
              unplaced={anchors.unplaced}
              expandedThreads={expandedThreads}
              flashThread={flashThread}
              onToggleThread={onToggleThread}
              onOpenDoc={onNavigate}
              onNotify={onNotify}
            />
          </>
        ) : reader.threads.length === 0 ? null : (
          <div className="thread-slots">
            {reader.threads.map((row) => (
              <ThreadSlot
                key={row.id}
                row={row}
                expanded={expandedThreads.includes(row.id)}
                flashing={flashThread === row.id}
                onToggle={() => {
                  onToggleThread(row.id);
                }}
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
          expandedThreads={expandedThreads}
          flashThread={flashThread}
          onToggleThread={onToggleThread}
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
          onSubmit={anchors.submitComment}
          onClose={anchors.cancelComment}
        />
      )}
    </>
  );
}
