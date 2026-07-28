import { useCallback, useMemo, useState } from "react";
import type { NavEntry } from "../board/useBoardLocalState";

/**
 * A reader's navigation history (SPEC.md §11): "each reader keeps its own
 * navigation stack — following `[[refs]]`, backlinks, or thread-context links
 * pushes; Back pops with scroll position restored; the reader exits to its list
 * only when the stack empties".
 *
 * Two things make this a shared unit rather than two similar bits of state.
 * First, a column reader's stack is **persisted** (it survives a reload) while
 * focus mode's is **in memory**, so the storage has to be injectable — hence
 * {@link NavStackStore}. Second, the semantics are subtle in exactly the places
 * a second implementation would get wrong: the scroll offset is captured on the
 * entry being *left*, a self-referential ref still pushes, and popping the last
 * entry means "show the list" rather than "show an empty reader".
 */

export type { NavEntry };

/** Where the stack lives. The column's is `localStorage`; focus mode's is React state. */
export interface NavStackStore {
  readonly stack: readonly NavEntry[];
  readonly setStack: (next: readonly NavEntry[]) => void;
}

export interface NavStackApi {
  readonly stack: readonly NavEntry[];
  /** The document showing now, or `null` when the stack is empty. */
  readonly docId: string | null;
  /** The entry Back would reveal — what the back button is named after. */
  readonly previous: NavEntry | null;
  /** Where the current entry should be scrolled to; `0` for a fresh push. */
  readonly restoreY: number;
  readonly depth: number;
  /**
   * Follows a ref, a backlink or a thread-context link. `currentScrollY` is
   * where the reader is right now, written into the entry being left so Back
   * can restore it exactly.
   */
  readonly push: (docId: string, currentScrollY: number) => void;
  /** Back. Pops one entry; popping the last one exits to the list. */
  readonly back: () => void;
  /** Shift-click Back / `⇧esc`: empties the stack in one act. */
  readonly toList: () => void;
  /** Records the live scroll offset on the current entry, without navigating. */
  readonly captureScroll: (scrollY: number) => void;
}

/** Follows a link: remembers where we were, then goes. */
export function pushEntry(
  stack: readonly NavEntry[],
  docId: string,
  currentScrollY: number,
): readonly NavEntry[] {
  // A self-referential ref (`[[thisDoc]]`) pushes like any other. De-duplicating
  // it into a no-op would leave the user having clicked a link that did nothing,
  // with no Back to undo — the stranding this deliberately avoids.
  const kept = stack.map((entry, index) =>
    index === stack.length - 1 ? { docId: entry.docId, scrollY: currentScrollY } : entry,
  );
  return [...kept, { docId, scrollY: 0 }];
}

/** Back. An already-empty stack stays empty rather than going negative. */
export function popEntry(stack: readonly NavEntry[]): readonly NavEntry[] {
  return stack.length === 0 ? stack : stack.slice(0, -1);
}

/** Writes the live scroll offset onto the top entry; a no-op on an empty stack. */
export function captureScrollAt(stack: readonly NavEntry[], scrollY: number): readonly NavEntry[] {
  const top = stack.at(-1);
  if (top === undefined || top.scrollY === scrollY) return stack;
  return [...stack.slice(0, -1), { docId: top.docId, scrollY }];
}

/**
 * Drops entries naming documents that no longer exist, on restore.
 *
 * SPEC.md's edge case: a stack restored from `localStorage` may name a document
 * the agent deleted while the tab was closed. Dropping the entry and continuing
 * is the only behaviour that does not strand the reader on an error card it
 * cannot navigate away from.
 */
export function dropMissing(
  stack: readonly NavEntry[],
  isMissing: (docId: string) => boolean,
): readonly NavEntry[] {
  const kept = stack.filter((entry) => !isMissing(entry.docId));
  return kept.length === stack.length ? stack : kept;
}

export function useNavStack(store: NavStackStore): NavStackApi {
  const { stack, setStack } = store;

  const push = useCallback(
    (docId: string, currentScrollY: number) => {
      setStack(pushEntry(stack, docId, currentScrollY));
    },
    [setStack, stack],
  );

  const back = useCallback(() => {
    setStack(popEntry(stack));
  }, [setStack, stack]);

  const toList = useCallback(() => {
    // One act, one state change: no intermediate document is ever rendered and
    // no intermediate scroll restoration runs.
    if (stack.length !== 0) setStack([]);
  }, [setStack, stack.length]);

  const captureScroll = useCallback(
    (scrollY: number) => {
      const next = captureScrollAt(stack, scrollY);
      if (next !== stack) setStack(next);
    },
    [setStack, stack],
  );

  return useMemo(() => {
    const top = stack.at(-1) ?? null;
    return {
      stack,
      docId: top?.docId ?? null,
      previous: stack.length >= 2 ? (stack[stack.length - 2] ?? null) : null,
      restoreY: top?.scrollY ?? 0,
      depth: stack.length,
      push,
      back,
      toList,
      captureScroll,
    };
  }, [back, captureScroll, push, stack, toList]);
}

/** An in-memory store, for a surface whose history is not persisted (focus mode). */
export function useMemoryNavStack(initial: readonly NavEntry[] = []): NavStackApi {
  const [stack, setStack] = useState<readonly NavEntry[]>(initial);
  const store = useMemo<NavStackStore>(() => ({ stack, setStack }), [stack]);
  return useNavStack(store);
}
