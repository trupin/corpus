import type { Lock } from "@corpus/contract";
import { MarkdownView, type RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { AnchorChips, DetachedThreads, MarginColumn } from "../anchors/AnchoredThreads";
import { CommentPopover } from "../anchors/CommentPopover";
import { useAnchorLayer } from "../anchors/useAnchorLayer";
import { useMarginLayout } from "../anchors/useMarginLayout";
import { DocEditor, editorHandlesType } from "../editor/DocEditor";
import { usePluginRegistry } from "../plugins/registry";
import { resolveDocPanel, resolveDocView } from "../plugins/slots";
import { ThreadCard } from "../thread/ThreadCard";
import { Backlinks } from "./Backlinks";
import { FrontmatterForm } from "./FrontmatterForm";
import { LockBanner } from "./LockBanner";
import { ThreadSlot } from "./ThreadSlot";
import type { ReaderDoc } from "./useReaderDoc";

/**
 * **The** document view. One component, two hosts (SPEC.md §11).
 *
 * The in-column reader and focus mode differ in chrome and in reading measure
 * and in nothing else: same frontmatter form, same lock banner, same ⋯ menu,
 * same 💬, same refs, same backlinks. Forking the rendering would let the two
 * drift, and §11 describes one document view rendered at two sizes.
 *
 * The body branch is where UI-006 landed: a markdown-bodied document renders
 * through `DocEditor` — always, including when it is locked, which is the same
 * surface at `editable: false` rather than a second read-only renderer
 * (sprint-011 Adjudication 7). `MarkdownView` keeps the two bodies the editor
 * is not for: a thread's conversation is `TurnList`, and a `view` or a
 * plugin-typed document is prose the board does not own.
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
  // The PLUGINS-001 slots, resolved once per render. A registered plugin
  // `View` replaces the standard document view — including the editor, were a
  // plugin ever to claim a core editable type (SPEC.md §10: "a doc whose
  // `type` has a registered `View` renders with it") — so the anchor layer is
  // not hosted either: the plugin owns its whole body surface.
  const PluginView =
    doc === undefined || reader.isThread ? null : resolveDocView(doc.frontmatter.type);
  const DocPanel =
    doc === undefined || reader.isThread ? null : resolveDocPanel(doc.frontmatter.type);
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

  if (doc === undefined) {
    return <p className="reader-note">Loading…</p>;
  }

  return (
    <>
      <div className="doc-main" ref={anchors.mainRef}>
        <FrontmatterForm
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
         * `null` — no plugin, no panel, no placeholder.
         */}
        {DocPanel !== null ? <DocPanel doc={doc} /> : null}

        {/*
         * The one body-rendering call site. A thread document's body IS its
         * conversation (SPEC.md §6: "the conversation is the document"), which is
         * why a thread opened from a column reads as turns rather than as the
         * markdown file behind them. A plugin `View` replaces the standard
         * document view wholesale for its registered type (SPEC.md §10); with
         * no plugin, a non-core type falls through to plain markdown — which is
         * exactly the deleted-plugin degradation §15 M6 checks.
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
         * card in the margin); only the ones that hang off no text are listed
         * here. A document the editor does not own has no anchors to place, so
         * every thread on it stays below the body, where UI-005 put them.
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
      </div>

      {anchors.marginMode ? (
        <MarginColumn
          threads={anchors.anchored.filter((thread) => !thread.orphaned)}
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
