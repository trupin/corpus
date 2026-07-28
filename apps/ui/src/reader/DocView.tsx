import { MarkdownView, type RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { Backlinks } from "./Backlinks";
import { FrontmatterForm } from "./FrontmatterForm";
import { LockBanner } from "./LockBanner";
import { ThreadSlot } from "./ThreadSlot";
import { TurnList } from "./Turns";
import type { ReaderDoc } from "./useReaderDoc";

/**
 * **The** document view. One component, two hosts (SPEC.md §11).
 *
 * The in-column reader and focus mode differ in chrome and in reading measure
 * and in nothing else: same frontmatter form, same lock banner, same ⋯ menu,
 * same 💬, same refs, same backlinks. Forking the rendering would let the two
 * drift, and §11 describes one document view rendered at two sizes.
 *
 * It is also the seam UI-006 replaces: there is exactly one `MarkdownView` call
 * site for a document body below, and swapping it for TipTap is that one edit.
 */

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
  const { doc, lock } = reader;

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
          <TurnList turns={reader.thread?.turns ?? []} onOpenRef={onNavigate} />
        </div>
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
              onOpenRef={onNavigate}
              onOpenThread={onNavigate}
            />
          ))}
        </div>
      )}

      <Backlinks backlinks={reader.backlinks} onOpen={onNavigate} />
    </>
  );
}
