import type { RowNotice } from "@corpus/kit";
import type { RevealTarget } from "@corpus/kit/plugin";
import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { useAbandonEmptyDoc } from "../abandon/useAbandonEmpty";
import type { NavEntry } from "../board/useBoardLocalState";
import { useCommentsTab } from "../comments/useCommentsTab";
import { useReaderContextMenu } from "../menu/useReaderContextMenu";
import { SaveStatusProvider } from "../editor/SaveChip";
import { ThreadCollapseProvider } from "../thread/ThreadCollapseContext";
import { columnSurface } from "../thread/threadCollapse";
import { DocView } from "./DocView";
import { DocWidthContext, useDocWidthSurface } from "./DocWidthContext";
import { ReaderHead } from "./ReaderHead";
import { dropMissing, useNavStack } from "./useNavStack";
import { useReaderDoc } from "./useReaderDoc";
import { useReaderSurface } from "./useReaderSurface";
import { EscapeLayerPriority, useEscapeLayer } from "./useEscapeStack";
import "./Reader.css";

/**
 * The per-column reader (SPEC.md §10): clicking a row opens the document **in
 * that column**, the column widens, and the reader replaces the list.
 *
 * Per column, not per route, and that is the whole design: several columns hold
 * different documents open side by side, each with its own history, which is the
 * wide-screen workflow §10 describes. A route would make "the open document" a
 * single global — and then two columns could not both be reading.
 */

export interface ReaderProps {
  readonly columnId: string;
  readonly columnTitle: string;
  readonly nav: readonly NavEntry[];
  readonly setNav: (nav: readonly NavEntry[]) => void;
  /** True right after creation: the title is focused *and* selected. */
  readonly selectTitle: boolean;
  /** Only the active column's reader consumes Escape (SPEC.md §10's active column). */
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

  return (
    /*
     * The folds are the column's, and they outlive every document it opens
     * (SPEC.md §10): "two columns showing the same document keep their own",
     * which is the same division that already gives each column its own scroll
     * position and its own navigation stack. So the provider wraps the reader
     * rather than sitting inside it, and is keyed by the column.
     */
    <ThreadCollapseProvider surfaceKey={columnSurface(columnId)}>
      <ColumnReader
        columnId={columnId}
        columnTitle={columnTitle}
        nav={nav}
        setNav={setNav}
        selectTitle={selectTitle}
        isActive={isActive}
        stack={stack}
        reader={reader}
        onFocusMode={onFocusMode}
        onNotify={onNotify}
      />
    </ThreadCollapseProvider>
  );
}

interface ColumnReaderProps extends ReaderProps {
  readonly stack: ReturnType<typeof useNavStack>;
  readonly reader: ReturnType<typeof useReaderDoc>;
}

/**
 * The reader proper, under the fold provider.
 *
 * Split out only so `useReaderSurface` runs **inside** the provider: the surface
 * expands a conversation when the 💬 popover jumps to it, and a hook called
 * beside a provider reads the context above it rather than the one it renders.
 */
function ColumnReader({
  columnId,
  columnTitle,
  nav,
  setNav,
  selectTitle,
  isActive,
  stack,
  reader,
  onFocusMode,
  onNotify,
}: ColumnReaderProps): ReactElement | null {
  const docId = stack.docId ?? "";

  /*
   * The reading measure this column is set to (SPEC.md §10's width rider).
   *
   * Per column, on UI-077's own surface key, and for the same reason its folds
   * and its scroll position are: two columns showing the same document keep
   * their own. Per **column** and not per document is what makes §10's "the
   * width persists across navigation" true — navigation is exactly what changes
   * the document, so a width that belonged to the document would be re-set on
   * every ref followed.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const docWidth = useDocWidthSurface(columnSurface(columnId), rootRef);

  const surface = useReaderSurface({
    reader,
    restoreY: stack.restoreY,
    navToken: `${docId}#${String(stack.depth)}`,
    onScroll: stack.captureScroll,
    // UI-037: where this open should land, when the caller said. Consuming it
    // takes it off the entry, so Back returns to a plain restoration.
    reveal: stack.reveal,
    onRevealed: stack.consumeReveal,
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

  /**
   * SPEC.md §10's "an empty document does not survive leaving it".
   *
   * The stack entry goes with the document, which is what keeps Back from
   * landing on something that no longer exists after the user followed a
   * `[[ref]]` out of a blank note (sprint-016 TEST-428).
   */
  useAbandonEmptyDoc({
    docId,
    doc: reader.doc,
    threadCount: reader.threads.length,
    onAbandoned: stack.drop,
  });

  // Which half of the reader is showing, and the comments list's two axes
  // (SPEC.md §10's rider). Per column: two readers on one document each keep
  // their own, exactly as their folds and their scroll do.
  const comments = useCommentsTab(docId, surface.jumpToThread);

  const contextMenu = useReaderContextMenu({
    doc: reader.doc,
    threadStatus: reader.isThread ? (reader.doc?.frontmatter.status ?? null) : null,
    onGone: stack.back,
    onNotify,
  });

  const navigate = useCallback(
    (next: string, reveal?: RevealTarget) => {
      stack.push(next, surface.currentScroll(), reveal);
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
    /*
     * The provider wraps the head *and* the body: the `.save-chip` lives in the
     * head and the editor that drives it lives in the scroll area below, and
     * they are siblings.
     */
    <SaveStatusProvider>
      <div
        className="reader"
        ref={rootRef}
        data-reader-doc={docId}
        data-reader-column={columnId}
        onContextMenu={contextMenu}
      >
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
          tab={comments.tab}
          onTab={comments.setTab}
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
          <DocWidthContext.Provider value={docWidth}>
            <DocView
              reader={reader}
              selectTitle={selectTitle}
              flashThread={surface.flashThread}
              tab={comments.tab}
              filters={comments.filters}
              onFilters={comments.setFilters}
              onReveal={comments.reveal}
              onNavigate={navigate}
              onNotify={onNotify}
            />
          </DocWidthContext.Provider>
        </div>
      </div>
    </SaveStatusProvider>
  );
}
