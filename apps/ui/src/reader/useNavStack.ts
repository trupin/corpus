import type { RevealTarget } from "@corpus/kit/plugin";
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
  /** The current entry's pending reveal (UI-037), or `null` once it is honoured. */
  readonly reveal: RevealTarget | null;
  readonly depth: number;
  /**
   * Follows a ref, a backlink or a thread-context link. `currentScrollY` is
   * where the reader is right now, written into the entry being left so Back
   * can restore it exactly. `reveal` says where inside the arriving document to
   * land, for the callers that know (UI-037).
   */
  readonly push: (docId: string, currentScrollY: number, reveal?: RevealTarget) => void;
  /** Back. Pops one entry; popping the last one exits to the list. */
  readonly back: () => void;
  /** Shift-click Back / `⇧esc`: empties the stack in one act. */
  readonly toList: () => void;
  /**
   * Forgets every entry naming a document that no longer exists.
   *
   * The abandon rule (SPEC.md §11) removes an empty document the moment it
   * stops being displayed, and an entry left behind would make Back land on a
   * tombstone.
   */
  readonly drop: (docId: string) => void;
  /** Records the live scroll offset on the current entry, without navigating. */
  readonly captureScroll: (scrollY: number) => void;
  /**
   * Forgets the current entry's reveal, once the reader has honoured it.
   *
   * This is what makes the instruction one-shot: the entry that is left behind
   * is an ordinary one, so Back onto it restores the scroll position the user
   * left and flashes nothing (UI-037).
   */
  readonly consumeReveal: () => void;
}

/** Follows a link: remembers where we were, then goes. */
export function pushEntry(
  stack: readonly NavEntry[],
  docId: string,
  currentScrollY: number,
  reveal?: RevealTarget,
): readonly NavEntry[] {
  // A self-referential ref (`[[thisDoc]]`) pushes like any other. De-duplicating
  // it into a no-op would leave the user having clicked a link that did nothing,
  // with no Back to undo — the stranding this deliberately avoids.
  //
  // The entry being left keeps its scroll offset and *loses* any reveal it had
  // not got round to honouring: it was an instruction about arriving, and the
  // user has already navigated past it.
  const kept = stack.map((entry, index) =>
    index === stack.length - 1 ? { docId: entry.docId, scrollY: currentScrollY } : entry,
  );
  return [...kept, reveal === undefined ? { docId, scrollY: 0 } : { docId, scrollY: 0, reveal }];
}

/** Back. An already-empty stack stays empty rather than going negative. */
export function popEntry(stack: readonly NavEntry[]): readonly NavEntry[] {
  return stack.length === 0 ? stack : stack.slice(0, -1);
}

/** Writes the live scroll offset onto the top entry; a no-op on an empty stack. */
export function captureScrollAt(stack: readonly NavEntry[], scrollY: number): readonly NavEntry[] {
  const top = stack.at(-1);
  if (top === undefined || top.scrollY === scrollY) return stack;
  // Spread, not rebuilt: revealing scrolls the reader, so the very first scroll
  // this records is often the one the reveal itself caused — and dropping the
  // instruction here would cancel it a frame before it was honoured.
  return [...stack.slice(0, -1), { ...top, scrollY }];
}

/** Drops the top entry's reveal once it has been honoured; a no-op when there is none. */
export function clearRevealAt(stack: readonly NavEntry[]): readonly NavEntry[] {
  const top = stack.at(-1);
  if (top === undefined || top.reveal === undefined) return stack;
  return [...stack.slice(0, -1), { docId: top.docId, scrollY: top.scrollY }];
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
    (docId: string, currentScrollY: number, reveal?: RevealTarget) => {
      setStack(pushEntry(stack, docId, currentScrollY, reveal));
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

  const drop = useCallback(
    (docId: string) => {
      const next = dropMissing(stack, (id) => id === docId);
      if (next !== stack) setStack(next);
    },
    [setStack, stack],
  );

  const captureScroll = useCallback(
    (scrollY: number) => {
      const next = captureScrollAt(stack, scrollY);
      if (next !== stack) setStack(next);
    },
    [setStack, stack],
  );

  const consumeReveal = useCallback(() => {
    const next = clearRevealAt(stack);
    if (next !== stack) setStack(next);
  }, [setStack, stack]);

  return useMemo(() => {
    const top = stack.at(-1) ?? null;
    return {
      stack,
      docId: top?.docId ?? null,
      previous: stack.length >= 2 ? (stack[stack.length - 2] ?? null) : null,
      restoreY: top?.scrollY ?? 0,
      reveal: top?.reveal ?? null,
      depth: stack.length,
      push,
      back,
      toList,
      drop,
      captureScroll,
      consumeReveal,
    };
  }, [back, captureScroll, consumeReveal, drop, push, stack, toList]);
}

/** An in-memory store, for a surface whose history is not persisted (focus mode). */
export function useMemoryNavStack(initial: readonly NavEntry[] = []): NavStackApi {
  const [stack, setStack] = useState<readonly NavEntry[]>(initial);
  const store = useMemo<NavStackStore>(() => ({ stack, setStack }), [stack]);
  return useNavStack(store);
}
