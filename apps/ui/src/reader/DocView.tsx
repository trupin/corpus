import type { Lock } from "@corpus/contract";
import { MarkdownView, type RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { DocEditor, editorHandlesType } from "../editor/DocEditor";
import type { EditorSelection } from "../editor/selection";
import type { AnchorReport } from "../editor/useAutosave";
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
  /** 💬 Comment in the editor's selection toolbar. UI-007 consumes the payload. */
  readonly onComment?: ((selection: EditorSelection) => void) | undefined;
  /** Every save's anchor reconciliation report (SPEC.md §6). UI-007 consumes it. */
  readonly onAnchors?: ((report: AnchorReport) => void) | undefined;
}

export function DocView({
  reader,
  selectTitle,
  expandedThreads,
  flashThread,
  onToggleThread,
  onNavigate,
  onNotify,
  onComment,
  onAnchors,
}: DocViewProps): ReactElement {
  const { doc } = reader;
  const lock = foreignLock(reader.lock);

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
       * The one body-rendering call site. A thread document's body IS its
       * conversation (SPEC.md §6: "the conversation is the document"), which is
       * why a thread opened from a column reads as turns rather than as the
       * markdown file behind them.
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
      ) : editorHandlesType(doc.frontmatter.type) ? (
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
          onComment={onComment}
          onAnchors={onAnchors}
        />
      ) : (
        <MarkdownView markdown={doc.body} className="doc-body" onOpenRef={onNavigate} />
      )}

      {reader.threads.length === 0 ? null : (
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
    </>
  );
}
