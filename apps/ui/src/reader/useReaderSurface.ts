import { useMarkThreadSeen } from "@corpus/kit";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ReaderDoc } from "./useReaderDoc";

/**
 * The behaviour a reading surface has regardless of the chrome around it:
 * scroll restoration, which threads are expanded, the 💬 jump-and-flash, and
 * SPEC.md §7's read rule.
 *
 * Shared by the column reader and focus mode for the same reason `DocView` is —
 * these are properties of *reading a document*, and two copies would drift.
 */

/** How long a thread's border flashes after the 💬 popover jumps to it. */
export const FLASH_MS = 1200;

/** How long the surface may go without persisting a scroll position. */
const SCROLL_PERSIST_MS = 150;

export interface ReaderSurfaceOptions {
  readonly reader: ReaderDoc;
  /** Where this navigation entry should be scrolled to; `0` for a fresh push. */
  readonly restoreY: number;
  /**
   * Changes on every navigation and only then. Restoration keys off this rather
   * than off the document id, because a self-referential ref pushes the same id
   * and Back to the same id at a different depth is a different position.
   */
  readonly navToken: string;
  /** Persists the live scroll offset onto the current navigation entry. */
  readonly onScroll: (scrollY: number) => void;
}

/** One navigation's restoration: where it is going, and what it last wrote. */
interface RestoreState {
  readonly token: string;
  target: number;
  /** The clamped offset this surface last set, or `null` before the first pass. */
  applied: number | null;
}

export interface ReaderSurface {
  readonly scrollRef: RefObject<HTMLDivElement>;
  readonly expandedThreads: readonly string[];
  readonly flashThread: string | null;
  readonly toggleThread: (threadId: string) => void;
  /** The 💬 popover's action: expand the slot, scroll to it, flash it. */
  readonly jumpToThread: (threadId: string) => void;
  readonly handleScroll: (scrollY: number) => void;
  /** Reads the live offset — what `push` writes onto the entry being left. */
  readonly currentScroll: () => number;
}

export function useReaderSurface({
  reader,
  restoreY,
  navToken,
  onScroll,
}: ReaderSurfaceOptions): ReaderSurface {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedThreads, setExpanded] = useState<readonly string[]>([]);
  const [flashThread, setFlash] = useState<string | null>(null);
  const restore = useRef<RestoreState | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSeen = useMarkThreadSeen();
  const seenFor = useRef<string | null>(null);

  const hasContent = reader.doc !== undefined || reader.isMissing || reader.error !== null;

  /**
   * Restoration, in a layout effect so the position is never painted wrong first.
   *
   * The subtlety is that the offset a reader is restoring to may not exist yet.
   * On a cold reload the body arrives before the backlinks panel and the thread
   * chips, so the container is several hundred pixels shorter than it was when
   * the offset was recorded, and a single assignment silently clamps — the user
   * lands near the bottom instead of where they were. So this **converges**:
   * re-applying while the target is still out of reach, and stopping the instant
   * either the target is met or the reader has moved on its own.
   *
   * "Moved on its own" is the whole guard, and it is what SPEC's "do not
   * re-restore and yank the user" is about: once `scrollTop` differs from the
   * value this effect last wrote, the user has scrolled, and the surface never
   * touches it again for this navigation.
   */
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;

    if (restore.current?.token !== navToken) {
      if (!hasContent) return;
      // A scroll capture still in its debounce window belongs to the entry we
      // are leaving, and `push` already wrote that offset synchronously and
      // exactly. Letting it land after the navigation would stamp the previous
      // document's offset onto the new one.
      if (scrollTimer.current !== null) {
        clearTimeout(scrollTimer.current);
        scrollTimer.current = null;
      }
      restore.current = { token: navToken, target: restoreY, applied: null };
    }

    const state = restore.current;
    if (state.applied !== null) {
      if (state.applied === state.target) return;
      if (element.scrollTop !== state.applied) {
        // The reader moved without us. Done — for this navigation, forever.
        state.applied = state.target;
        return;
      }
    }
    element.scrollTop = state.target;
    // The clamped value, which is what the next pass compares against.
    state.applied = element.scrollTop;
  });

  // A new document starts collapsed: which threads were open is about the
  // document being read, not about the surface reading it.
  useEffect(() => {
    setExpanded([]);
    setFlash(null);
  }, [reader.docId]);

  /**
   * SPEC.md §7: opening a thread marks it seen. Opening a *parent* document
   * marks nothing — its threads are collapsed chips, and a chip has displayed
   * nothing. That asymmetry is the rule, and it is enforced by this condition
   * being `isThread` and by `ThreadSlot` firing on expansion instead.
   */
  useEffect(() => {
    if (!reader.isThread || reader.doc === undefined) return;
    if (seenFor.current === reader.docId) return;
    seenFor.current = reader.docId;
    markSeen.mutate(reader.docId);
  }, [markSeen, reader.doc, reader.docId, reader.isThread]);

  useEffect(
    () => () => {
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    },
    [],
  );

  const handleScroll = useCallback(
    (scrollY: number) => {
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => {
        scrollTimer.current = null;
        onScroll(scrollY);
      }, SCROLL_PERSIST_MS);
    },
    [onScroll],
  );

  const toggleThread = useCallback((threadId: string) => {
    setExpanded((current) =>
      current.includes(threadId) ? current.filter((id) => id !== threadId) : [...current, threadId],
    );
  }, []);

  const jumpToThread = useCallback((threadId: string) => {
    setExpanded((current) => (current.includes(threadId) ? current : [...current, threadId]));
    setFlash(threadId);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setFlash(null);
    }, FLASH_MS);
  }, []);

  const currentScroll = useCallback(() => scrollRef.current?.scrollTop ?? 0, []);

  return {
    scrollRef,
    expandedThreads,
    flashThread,
    toggleThread,
    jumpToThread,
    handleScroll,
    currentScroll,
  };
}
