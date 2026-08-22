import type { RevealTarget } from "@corpus/kit";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useThreadCollapse } from "../thread/ThreadCollapseContext";
import { readStateOf } from "../thread/threadCollapse";
import { useToast } from "../shell/Toasts";
import {
  revealItem,
  revealMissNotice,
  revealPatience,
  surfaceSettled,
  surfaceText,
  type RevealGaveUp,
} from "./reveal";
import type { ReaderDoc } from "./useReaderDoc";

/**
 * The behaviour a reading surface has regardless of the chrome around it:
 * scroll restoration and the 💬 jump-and-flash.
 *
 * **Which conversations are folded is deliberately not here any more.** It used
 * to be — a list of expanded thread ids in React state, reset to empty on every
 * document change, so a reader who opened four conversations to read a paragraph
 * found them all closed again after following one `[[ref]]`. SPEC.md §10 now
 * makes a fold **sticky** ("through navigating away and back, and through a
 * reload"), and browser-local per reader, which is a different lifetime from
 * anything else on this surface: it outlives the navigation, so it lives in
 * `ThreadCollapseProvider` and is keyed by the surface rather than held by it.
 *
 * **The read mark is deliberately not here either.** SPEC.md §7 counts
 * *displayed* content, and the only component that knows a conversation was
 * displayed is the one that displayed it — so `ThreadCard` marks seen on mount
 * and the kit de-duplicates per `(thread, last turn)`. A surface-level effect
 * keyed on "the open document is a thread" would mark a thread seen whose turns
 * had not arrived yet, and would say nothing at all about a folded one.
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
  /**
   * Where inside the arriving document to land (UI-037), or `null` for an
   * ordinary open. Honoured once the document has rendered — never on a
   * restoration, because the caller clears it through {@link onRevealed} the
   * moment it is honoured and Back therefore arrives at an entry with none.
   */
  readonly reveal?: RevealTarget | null | undefined;
  /** Called once the reveal has been acted on — or given up on. */
  readonly onRevealed?: (() => void) | undefined;
}

/** One navigation's restoration: where it is going, and what it last wrote. */
interface RestoreState {
  readonly token: string;
  target: number;
  /** The clamped offset this surface last set, or `null` before the first pass. */
  applied: number | null;
}

export interface ReaderSurface {
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly flashThread: string | null;
  /** The 💬 popover's action: expand the conversation, scroll to it, flash it. */
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
  reveal,
  onRevealed,
}: ReaderSurfaceOptions): ReaderSurface {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [flashThread, setFlash] = useState<string | null>(null);
  const collapse = useThreadCollapse();
  /*
   * Read through refs so `jumpToThread` never changes identity: it is a
   * dependency of the reveal effect below, and an effect that tore itself down
   * mid-retry would leave a pending reveal instruction with nobody to honour it.
   */
  const expand = useRef(collapse.expand);
  expand.current = collapse.expand;
  const rows = useRef(reader.threads);
  rows.current = reader.threads;
  /** Whether that list has answered — read through a ref for the same reason. */
  const threadsSettled = useRef(reader.threadsSettled);
  threadsSettled.current = reader.threadsSettled;
  const restore = useRef<RestoreState | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The reveal this surface has already acted on, by identity. */
  const revealed = useRef<RevealTarget | null>(null);
  /**
   * The lit reveal flash, and the navigation entry it belongs to.
   *
   * The token is half of it, not bookkeeping: the flash is drawn over one
   * document and kept on its line by an animation-frame loop that re-finds the
   * text every frame, so the moment the surface shows a *different* document
   * that loop is hunting through the wrong one. Recording which navigation lit
   * it is what lets the surface put it out on the way past — and, because the
   * question is "is this still that navigation" rather than "did an effect
   * re-run", StrictMode's replayed effects leave it alone.
   */
  const revealFlash = useRef<{ readonly nav: string; readonly stop: () => void } | null>(null);
  /**
   * The reveal still looking for its words, and the navigation that asked for it.
   *
   * Held here rather than torn down by the effect's own cleanup, for the reason
   * the comment on {@link revealedCallback} gives in a smaller way: the search
   * outlives the render that started it, and an effect that re-runs for a reason
   * unrelated to the instruction — `hasContent` flickering across a refetch —
   * would cancel a ladder mid-climb and then take the `revealed` guard's early
   * return, leaving the instruction pending with nobody left to honour it. Its
   * lifetime is the navigation's, exactly like {@link revealFlash}'s.
   */
  const revealSearch = useRef<{ readonly nav: string; readonly stop: () => void } | null>(null);
  /** Read through a ref so the reveal effect never depends on the token. */
  const navTokenRef = useRef(navToken);
  navTokenRef.current = navToken;
  /**
   * Read through a ref so the retry ladder below is not a dependency of the
   * caller's identity: `consumeReveal` is rebuilt on every navigation-stack
   * write, and a scroll captured mid-ladder would otherwise tear the effect
   * down between two attempts and leave the instruction pending forever.
   */
  const revealedCallback = useRef(onRevealed);
  revealedCallback.current = onRevealed;
  /**
   * How a reveal that gave up says so (UI-140).
   *
   * Read from the shared toast context rather than taken as a prop, because both
   * hosts of this hook already sit inside `ToastProvider` and neither passes a
   * notifier down to it. Outside a provider `useToast` is a no-op, so a surface
   * rendered in isolation reports nothing rather than crashing.
   */
  const toast = useToast();
  const notify = useRef(toast);
  notify.current = toast;

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

  /*
   * A new document clears the flash and nothing else.
   *
   * It used to clear the folds too, which is exactly what SPEC.md §10 now
   * forbids: a fold survives navigating away and back. The flash does not — it
   * is a 1.2 s pointer at one conversation on the document being left.
   */
  useEffect(() => {
    setFlash(null);
  }, [reader.docId]);

  useEffect(
    () => () => {
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      revealFlash.current?.stop();
      revealFlash.current = null;
      revealSearch.current?.stop();
      revealSearch.current = null;
    },
    [],
  );

  /**
   * A reveal flash does not outlive its navigation.
   *
   * Unmounting the surface already put it out; navigating *within* it did not,
   * and that is the ordinary case — a reveal lights for 1.2 s and a reader can
   * follow a ref in half of that. What stayed behind was not just a highlight
   * over the wrong document but its tracker, re-searching the newly opened body
   * for the old document's words on every frame.
   *
   * The unfinished *search* goes the same way and for the same reason: a reveal
   * still waiting for one document's words to arrive has no business finding
   * them in the next one (UI-140).
   */
  useEffect(() => {
    const live = revealFlash.current;
    if (live !== null && live.nav !== navToken) {
      live.stop();
      revealFlash.current = null;
    }
    const looking = revealSearch.current;
    if (looking !== null && looking.nav !== navToken) {
      looking.stop();
      revealSearch.current = null;
    }
  }, [navToken]);

  const jumpToThread = useCallback((threadId: string) => {
    // Jumping to a conversation expands it: the reader asked for it by name, and
    // that is the reader's own act overriding the rule (SPEC.md §10).
    const row = rows.current.find((candidate) => candidate.id === threadId);
    if (row !== undefined) {
      expand.current({ threadId, status: row.status, readState: readStateOf(row.unread) });
    }
    setFlash(threadId);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setFlash(null);
    }, FLASH_MS);
  }, []);

  /**
   * The reveal, honoured exactly once (UI-037).
   *
   * Two guards, because two different things could fire it twice. `revealed`
   * holds the instruction by identity, which covers a re-render — including
   * StrictMode's double-invoked effect — while `onRevealed` takes the
   * instruction off the navigation entry, which is what covers a *reload* and a
   * Back onto the same entry. Neither alone is enough: the first does not
   * survive a remount and the second does not survive React calling the effect
   * twice before the state it sets has landed.
   *
   * **Giving up counts as honouring it, and it is not silent** (UI-140). The
   * instruction is spent in every terminal case — drawn, or given up on for
   * either of `revealPatience`'s two reasons — and the reason it is spent even
   * when nothing was drawn is worth stating, because the alternative looks
   * kinder than it is. A reveal lives on the navigation entry, in
   * `localStorage`; leaving one pending makes Back and a reload silently
   * re-attempt a reveal that has already failed, against a document that has
   * moved on further, with nothing in between that would make the next attempt
   * different. So the instruction goes, and what replaces it is an account: a
   * reveal that drew nothing raises a notice naming the quote it could not find.
   *
   * **The search is condition-shaped, not duration-shaped.** It looks once per
   * animation frame and re-searches only when what it is aimed at changed,
   * because a surface that has not changed cannot have gained the words. When it
   * stops is `revealPatience`'s decision, and that comment is where the two
   * failure modes — "not there" and "not there yet" — are told apart. Each look
   * reads both halves of that question: the words, and whether what is being
   * waited on has arrived — `DocView`'s body rather than its `Loading…`, the
   * conversation list rather than an empty array that has answered nothing.
   *
   * **Both destinations climb the same ladder**, which they did not used to. A
   * thread reveal fired the instant the *document* had content and then spent
   * the instruction, but `reader.threads` is a second request and arrives on its
   * own schedule: an empty list reads the same whether the document has no
   * conversations or the list has not landed (`useReaderDoc`'s
   * {@link ReaderDoc.threadsSettled} says so in as many words). So a thread
   * reveal on a cold open silently expanded nothing, at 1 open in 80 measured
   * under eight Playwright workers — the same defect as the item branch's, one
   * request over.
   */
  useEffect(() => {
    if (reveal == null || !hasContent || revealed.current === reveal) return undefined;
    revealed.current = reveal;

    const nav = navTokenRef.current;
    const started = Date.now();
    const patience = revealPatience();
    /*
     * The frame clock, or `null` where there is none. A host without
     * `requestAnimationFrame` has no layout either — jsdom without
     * `pretendToBeVisual`, any non-browser render — so its surface will never
     * change and there is nothing to wait for: one look, and an answer.
     *
     * It falls back to `globalThis` rather than to "no clock" when the container
     * is not mounted yet, because "the reader has not rendered its scroller" is
     * the one moment where giving an answer would be most wrong.
     */
    const view = scrollRef.current?.ownerDocument.defaultView ?? globalThis;
    const frames = typeof view.requestAnimationFrame === "function" ? view : null;
    let handle: number | null = null;

    const search = {
      nav,
      stop: () => {
        if (handle !== null && frames !== null) frames.cancelAnimationFrame(handle);
        handle = null;
      },
    };

    /**
     * Where this reveal is aimed: what it can see, and what honouring it there
     * would take. Two destinations, one ladder — the only thing that differs
     * between an item and a conversation is which arriving thing they wait on.
     */
    const aim =
      reveal.kind === "thread"
        ? {
            // The settled flag belongs in the reading, not beside it: a list
            // that answers "no conversations at all" leaves `threads` empty and
            // would otherwise look identical to a list still in flight, so the
            // one moment that distinguishes them would pass unseen.
            read: () => ({
              text: rows.current.map((row) => row.id).join(" "),
              settled: threadsSettled.current,
            }),
            take: () => {
              if (!rows.current.some((row) => row.id === reveal.threadId)) return false;
              jumpToThread(reveal.threadId);
              return true;
            },
          }
        : {
            read: () => {
              const container = scrollRef.current;
              // A reader with no scroller has neither words nor a verdict about
              // itself: unsettled, which is what keeps it being waited for.
              return container === null
                ? { text: "", settled: false }
                : { text: surfaceText(container), settled: surfaceSettled(container) };
            },
            take: () => {
              const container = scrollRef.current;
              const undo = container === null ? null : revealItem(container, reveal);
              if (undo === null) return false;
              revealFlash.current?.stop();
              revealFlash.current = { nav, stop: undo };
              return true;
            },
          };

    /** Spends the instruction, and says so when nothing was reached. */
    const settle = (gaveUp: RevealGaveUp | null): void => {
      if (revealSearch.current === search) revealSearch.current = null;
      if (gaveUp !== null) notify.current(revealMissNotice(reveal, gaveUp));
      revealedCallback.current?.();
    };

    const look = (): void => {
      handle = null;
      const verdict = patience(aim.read(), Date.now() - started);
      if (verdict.search && aim.take()) {
        settle(null);
        return;
      }
      if (verdict.giveUp !== null) {
        settle(verdict.giveUp);
        return;
      }
      if (frames === null) {
        settle("unresolved");
        return;
      }
      handle = frames.requestAnimationFrame(look);
    };

    revealSearch.current?.stop();
    revealSearch.current = search;
    look();

    // No cleanup: the search's lifetime is the navigation's, not this effect's
    // — see `revealSearch`.
    return undefined;
  }, [hasContent, jumpToThread, reveal]);

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

  const currentScroll = useCallback(() => scrollRef.current?.scrollTop ?? 0, []);

  return { scrollRef, flashThread, jumpToThread, handleScroll, currentScroll };
}
