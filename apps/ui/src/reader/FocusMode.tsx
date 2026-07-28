import type { RowNotice } from "@corpus/kit";
import { useCallback, useEffect, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { DocView } from "./DocView";
import { ReaderHead } from "./ReaderHead";
import { useMemoryNavStack } from "./useNavStack";
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
  readonly onClose: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * The prototype reads `esc closes · click anywhere to edit`. The second clause
 * is UI-006's — there is no editing surface to click into yet — and a hint that
 * tells the user to do something the build cannot do is worse than a short hint.
 */
export const FOCUS_HINT = "esc closes";

export function FocusMode({ docId, listTitle, onClose, onNotify }: FocusModeProps): ReactElement {
  const stack = useMemoryNavStack([{ docId, scrollY: 0 }]);
  const current = stack.docId ?? docId;
  const reader = useReaderDoc(current);

  const surface = useReaderSurface({
    reader,
    restoreY: stack.restoreY,
    navToken: `${current}#${String(stack.depth)}`,
    onScroll: stack.captureScroll,
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
    <div className="focus open" role="dialog" aria-modal="true" aria-label="Full screen reader">
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
            expandedThreads={surface.expandedThreads}
            flashThread={surface.flashThread}
            onToggleThread={surface.toggleThread}
            onNavigate={navigate}
            onNotify={onNotify}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
