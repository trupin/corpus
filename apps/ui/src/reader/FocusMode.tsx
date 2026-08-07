import type { RowNotice } from "@corpus/kit";
import type { RevealTarget } from "@corpus/kit/plugin";
import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useAbandonEmptyDoc } from "../abandon/useAbandonEmpty";
import { SaveStatusProvider } from "../editor/SaveChip";
import { useReaderContextMenu } from "../menu/useReaderContextMenu";
import { ThreadCollapseProvider } from "../thread/ThreadCollapseContext";
import { FOCUS_SURFACE } from "../thread/threadCollapse";
import { DocView } from "./DocView";
import { ReaderHead } from "./ReaderHead";
import { rootEntry, useMemoryNavStack } from "./useNavStack";
import { useReaderDoc } from "./useReaderDoc";
import { useReaderSurface } from "./useReaderSurface";
import { EscapeLayerPriority, useEscapeLayer } from "./useEscapeStack";
import "./FocusMode.css";

/**
 * Focus mode (SPEC.md §11's ⤢): a full-viewport reading surface over the board.
 *
 * **Its own navigation stack.** Entering focus from a column and following two
 * refs there must leave the column's history exactly as it was — the column is
 * still sitting behind the overlay at its own position, and closing focus
 * returns to it. So the stack is a separate one, held in memory: focus is a
 * reading excursion, not a place the board was left.
 *
 * Portalled to `document.body` so a `position: fixed` overlay can never be
 * caught by an ancestor's containing block or clipped by the board's horizontal
 * scroller.
 */

export interface FocusModeProps {
  readonly docId: string;
  /** Named on the back button when the focus stack has no depth. */
  readonly listTitle: string;
  /**
   * Where inside the document to land (UI-037). Focus mode honours it through
   * the same shared surface the column reader does — one reveal mechanism, two
   * hosts, exactly as `DocView` is one document view rendered at two sizes.
   */
  readonly reveal?: RevealTarget | undefined;
  readonly onClose: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * `design/index.html`'s hint, in full now that the second clause is true: the
 * body below is a live editor and clicking anywhere in it does place a caret
 * (UI-006). It was deliberately truncated while it was not.
 */
export const FOCUS_HINT = "esc closes · click anywhere to edit";

export function FocusMode(props: FocusModeProps): ReactElement {
  /*
   * Focus mode is one surface, because there is only ever one full-screen
   * reader — and it is its **own**, distinct from the column it was opened
   * from: SPEC.md §11 makes a fold per reader, and focus mode keeps its own
   * navigation stack for exactly the same reason (it is a reading excursion,
   * not a place the board was left).
   */
  return (
    <ThreadCollapseProvider surfaceKey={FOCUS_SURFACE}>
      <FocusReader {...props} />
    </ThreadCollapseProvider>
  );
}

/** The overlay proper, under the fold provider — see `Reader`'s split. */
function FocusReader({
  docId,
  listTitle,
  reveal,
  onClose,
  onNotify,
}: FocusModeProps): ReactElement {
  const stack = useMemoryNavStack([rootEntry(docId, reveal)]);
  const current = stack.docId ?? docId;
  const reader = useReaderDoc(current);

  /**
   * The overlay is a live component, not a one-shot (PR #19 review).
   *
   * `docId` and `reveal` seeded the stack at mount and were then ignored, so a
   * board that pointed an *already open* focus mode at another document — or at
   * another place in the same one — changed nothing on screen. The excursion
   * this overlay was holding belongs to the instruction it replaces, so a new
   * one starts the history again rather than pushing onto it.
   *
   * Compared by identity, and both props are stable while the instruction is:
   * `Board` holds them in one state object, so re-seeding cannot loop.
   */
  const opened = useRef({ docId, reveal });
  const { openAt } = stack;
  useEffect(() => {
    if (opened.current.docId === docId && opened.current.reveal === reveal) return;
    opened.current = { docId, reveal };
    openAt(docId, reveal);
  }, [docId, openAt, reveal]);

  const surface = useReaderSurface({
    reader,
    restoreY: stack.restoreY,
    navToken: `${current}#${String(stack.depth)}`,
    onScroll: stack.captureScroll,
    reveal: stack.reveal,
    onRevealed: stack.consumeReveal,
  });

  /**
   * The same rule in the other host (SPEC.md §11). `DocView` is one component
   * with two hosts, and a rule implemented in only one of them is a bug — but
   * the *count* in the registry is what makes closing focus mode over a
   * document its column still has open a non-event.
   */
  useAbandonEmptyDoc({
    docId: current,
    doc: reader.doc,
    threadCount: reader.threads.length,
    onAbandoned: stack.drop,
  });

  const contextMenu = useReaderContextMenu({
    doc: reader.doc,
    threadStatus: reader.isThread ? (reader.doc?.frontmatter.status ?? null) : null,
    onGone: stack.back,
    onNotify,
  });

  const navigate = useCallback(
    (next: string) => {
      stack.push(next, surface.currentScroll());
    },
    [stack, surface],
  );

  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Focus, onEscape: onClose });

  // Back past the bottom of the focus stack closes focus rather than leaving an
  // empty overlay with nothing in it.
  useEffect(() => {
    if (stack.depth === 0) onClose();
  }, [onClose, stack.depth]);

  return createPortal(
    <SaveStatusProvider>
      <div
        className="focus open"
        role="dialog"
        aria-modal="true"
        aria-label="Full screen reader"
        onContextMenu={contextMenu}
      >
        <ReaderHead
          docId={current}
          doc={reader.doc}
          threads={reader.threads}
          threadStatus={reader.isThread ? (reader.doc?.frontmatter.status ?? null) : null}
          previous={stack.previous}
          listTitle={listTitle}
          hint={FOCUS_HINT}
          variant="focus"
          leading={
            <button type="button" className="back" data-close-focus onClick={onClose}>
              ✕ Close
            </button>
          }
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
          className="focus-scroll"
          onScroll={(event) => {
            surface.handleScroll(event.currentTarget.scrollTop);
          }}
        >
          <div className="focus-inner">
            <DocView
              reader={reader}
              selectTitle={false}
              flashThread={surface.flashThread}
              onNavigate={navigate}
              onNotify={onNotify}
            />
          </div>
        </div>
      </div>
    </SaveStatusProvider>,
    document.body,
  );
}
