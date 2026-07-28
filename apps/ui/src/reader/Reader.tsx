import type { RowNotice } from "@corpus/kit";
import { useCallback, useEffect, type ReactElement } from "react";
import type { NavEntry } from "../board/useBoardLocalState";
import { DocView } from "./DocView";
import { ReaderHead } from "./ReaderHead";
import { dropMissing, useNavStack } from "./useNavStack";
import { useReaderDoc } from "./useReaderDoc";
import { useReaderSurface } from "./useReaderSurface";
import { EscapeLayerPriority, useEscapeLayer } from "./useEscapeStack";
import "./Reader.css";

/**
 * The per-column reader (SPEC.md §11): clicking a row opens the document **in
 * that column**, the column widens, and the reader replaces the list.
 *
 * Per column, not per route, and that is the whole design: several columns hold
 * different documents open side by side, each with its own history, which is the
 * wide-screen workflow §11 describes. A route would make "the open document" a
 * single global — and then two columns could not both be reading.
 */

export interface ReaderProps {
  readonly columnId: string;
  readonly columnTitle: string;
  readonly nav: readonly NavEntry[];
  readonly setNav: (nav: readonly NavEntry[]) => void;
  /** True right after creation: the title is focused *and* selected. */
  readonly selectTitle: boolean;
  /** Only the active column's reader consumes Escape (SPEC.md §11's active column). */
  readonly isActive: boolean;
  readonly onFocusMode: (docId: string) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function Reader({
  columnId,
  columnTitle,
  nav,
  setNav,
  selectTitle,
  isActive,
  onFocusMode,
  onNotify,
}: ReaderProps): ReactElement | null {
  const stack = useNavStack({ stack: nav, setStack: setNav });
  const docId = stack.docId ?? "";
  const reader = useReaderDoc(docId);

  const surface = useReaderSurface({
    reader,
    restoreY: stack.restoreY,
    navToken: `${docId}#${String(stack.depth)}`,
    onScroll: stack.captureScroll,
  });

  /**
   * A restored entry may name a document the agent deleted while the tab was
   * closed. Dropping it and continuing is the only behaviour that does not
   * strand the reader on a card it cannot navigate away from — and it is done
   * here, on the read failure, rather than by validating the whole stack up
   * front, which would cost one request per entry on every load.
   */
  useEffect(() => {
    if (!reader.isMissing || stack.depth < 2) return;
    setNav(dropMissing(nav, (id) => id === reader.docId));
  }, [nav, reader.docId, reader.isMissing, setNav, stack.depth]);

  const navigate = useCallback(
    (next: string) => {
      stack.push(next, surface.currentScroll());
    },
    [stack, surface],
  );

  useEscapeLayer({
    active: isActive && stack.depth > 0,
    priority: EscapeLayerPriority.Reader,
    // `⇧esc` is the keyboard form of shift-clicking Back: one act, straight to
    // the list, with no intermediate document rendered.
    onEscape: (event) => {
      if (event.shiftKey) stack.toList();
      else stack.back();
    },
  });

  if (stack.docId === null) return null;

  return (
    <div className="reader" data-reader-doc={docId} data-reader-column={columnId}>
      <ReaderHead
        docId={docId}
        doc={reader.doc}
        threads={reader.threads}
        threadStatus={reader.isThread ? (reader.doc?.frontmatter.status ?? null) : null}
        previous={stack.previous}
        listTitle={columnTitle}
        onExpand={() => {
          onFocusMode(docId);
        }}
        onBack={(toList) => {
          if (toList) stack.toList();
          else stack.back();
        }}
        onSelectThread={surface.jumpToThread}
        onGone={stack.back}
        onNotify={onNotify}
      />
      <div
        ref={surface.scrollRef}
        className="reader-scroll"
        onScroll={(event) => {
          surface.handleScroll(event.currentTarget.scrollTop);
        }}
      >
        <DocView
          reader={reader}
          selectTitle={selectTitle}
          expandedThreads={surface.expandedThreads}
          flashThread={surface.flashThread}
          onToggleThread={surface.toggleThread}
          onNavigate={navigate}
          onNotify={onNotify}
        />
      </div>
    </div>
  );
}
