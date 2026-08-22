import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  dropStaleOverride,
  isThreadCollapsed,
  readCollapseState,
  strongerReadState,
  surfaceOverrides,
  withOverride,
  withSurface,
  writeCollapseState,
  type SurfaceOverrides,
  type ThreadCollapseSubject,
  type ThreadReadState,
} from "./threadCollapse";

/**
 * One reading surface's folds, held where SPEC.md §10 says they belong: in the
 * browser, per reader, never on disk.
 *
 * **Per reader is the point, not an implementation detail.** "Two columns
 * showing the same document keep their own" is spelled out in the signed text,
 * and it falls straight out of §10's existing division — a column's scroll
 * position, its open reader and its navigation stack are already its own, and a
 * fold is the same kind of fact about *this* reader rather than about the
 * document. So the key is the column (or focus mode), and the entries inside it
 * are per thread — which is what makes a fold survive navigating away and back
 * to the same document, and a reload, without ever leaving this browser.
 *
 * A context rather than a prop: a conversation can be five levels of child
 * thread down inside a card inside a margin, and threading a fold through every
 * component between here and there would teach five components about a gesture
 * none of them otherwise cares about. `ThreadPanel` is the only consumer.
 */

export interface ThreadCollapseApi {
  readonly isCollapsed: (subject: ThreadCollapseSubject) => boolean;
  readonly setCollapsed: (subject: ThreadCollapseSubject, collapsed: boolean) => void;
  readonly toggle: (subject: ThreadCollapseSubject) => void;
  /** Expanding without asking first — what clicking an anchored highlight does. */
  readonly expand: (subject: ThreadCollapseSubject) => void;
  /**
   * A placed conversation reporting its current status.
   *
   * This is how "a change to the thread's **status** re-asserts the rule and
   * clears the override" happens without anybody polling: the panel that renders
   * a conversation says what its status is now, and an override taken against a
   * different one is dropped. Resolving a thread whose card is open on screen
   * therefore collapses it, and reopening one expands it, with no special case
   * anywhere for "the status just changed".
   */
  readonly observe: (subject: ThreadCollapseSubject) => void;
  /**
   * **Reading never collapses anything** (SPEC.md §10) — and this is the whole
   * of it, held by the surface rather than by a component (PR #25 re-review,
   * MINOR).
   *
   * The interlock keeps a conversation nobody has read out of the rule's reach.
   * But *displaying* one is what marks it read, so an interlock read off the
   * live flag disarms itself a round trip later: open a resolved thread holding
   * an unseen turn, the card renders, `POST …/seen` lands, the row comes back
   * `unread: false`, and the rule folds the conversation shut while the reader
   * is looking at it. So the surface records what a conversation was **placed**
   * with, and that record only ever gets more cautious ({@link
   * strongerReadState}) until the thread's **status** changes — §10's "the rule
   * is applied when a conversation is placed and when its status changes" — at
   * which point it is taken fresh.
   *
   * **Why the surface and not the panel.** The record used to be a ref inside
   * `ThreadPanel`, and the chip↔margin swap is an unmount and a remount: in
   * margin mode `useAnchorLayer.slotHost` answers `null`, so `AnchorChips` draws
   * nothing and `MarginColumn` mounts a fresh panel. Dragging a column past
   * `MARGIN_MIN_WIDTH` while reading a resolved conversation therefore re-placed
   * it against the row it had just marked read, and folded it mid-sentence — the
   * same defect the ref was added to fix, reached by a resize instead of a round
   * trip. Kept per surface it survives the swap, and {@link hold} is what keeps
   * it from surviving anything more.
   *
   * Called during render, because the answer decides that render. Idempotent.
   */
  readonly place: (subject: ThreadCollapseSubject) => ThreadReadState;
  /**
   * Keeps a conversation's placement record alive while it is **on screen**, and
   * exactly that long.
   *
   * A placement is a fresh decision every time §10 says one is made, so the
   * record must not outlive the conversation's stay on the surface: a resolved
   * thread placed expanded because it was unread, then read, then navigated away
   * from, must be folded when the reader comes back to it — otherwise the fix
   * above becomes the very bug this round is fixing elsewhere, a conversation
   * placed expanded forever.
   *
   * So panels hold the record and release it when they unmount, and the drop is
   * deferred by a microtask: React runs every removal's cleanup before every
   * addition's setup within one commit, so the chip↔margin swap dips to zero
   * holders and is back at one before the microtask runs. A navigation cannot
   * do that — its remount is a later task, after a fetch.
   *
   * Returns the release, so a caller is `useEffect(() => hold(id), [hold, id])`.
   */
  readonly hold: (threadId: string) => () => void;
}

/**
 * What a conversation was placed with, per thread, for as long as it is shown.
 *
 * Mutable on purpose: it is a record of one surface's own history, read during
 * render and written by the panels that show it, and turning it into state would
 * make placing a conversation a re-render of everything below the provider.
 */
interface Placement {
  status: string;
  readState: ThreadReadState;
  /** How many panels on this surface are showing it right now. */
  holders: number;
}

/**
 * The fallback when no surface has been provided.
 *
 * Applies the rule, forgets every gesture and remembers nothing about how a
 * conversation was placed — which is the honest answer for a conversation
 * rendered outside a reader: there is no surface for a fold or a placement to
 * belong to. Component tests that render a card on its own get the rule, not a
 * crash.
 */
const UNHOSTED: ThreadCollapseApi = {
  isCollapsed: (subject) => isThreadCollapsed({}, subject),
  setCollapsed: () => undefined,
  toggle: () => undefined,
  expand: () => undefined,
  observe: () => undefined,
  place: (subject) => subject.readState,
  hold: () => () => undefined,
};

const Context = createContext<ThreadCollapseApi>(UNHOSTED);

export function useThreadCollapse(): ThreadCollapseApi {
  return useContext(Context);
}

export interface ThreadCollapseProviderProps {
  /** `col:<columnId>` or `focus` — see `threadCollapse.ts`. */
  readonly surfaceKey: string;
  readonly children: ReactNode;
}

export function ThreadCollapseProvider({
  surfaceKey,
  children,
}: ThreadCollapseProviderProps): ReactElement {
  const [overrides, setOverrides] = useState<SurfaceOverrides>(() =>
    surfaceOverrides(readCollapseState(), surfaceKey),
  );
  /*
   * The live overrides, for the callbacks that fire from an event rather than
   * from a render — `toggle` is called out of a click handler that may have
   * been created several folds ago.
   */
  const latest = useRef(overrides);
  latest.current = overrides;

  /* What each conversation on this surface was placed with — see `place`. */
  const placements = useRef(new Map<string, Placement>());

  /*
   * A surface that changes identity mid-life starts from that surface's own
   * record rather than inheriting the previous one's.
   *
   * The **folds** are what belong to the surface, so only those are re-read.
   * `placements` is deliberately left alone: nothing has been re-placed — the
   * same panels are still mounted showing the same conversations — and clearing
   * it would strand their `hold` counts on entries that no longer exist.
   */
  const key = useRef(surfaceKey);
  useEffect(() => {
    if (key.current === surfaceKey) return;
    key.current = surfaceKey;
    setOverrides(surfaceOverrides(readCollapseState(), surfaceKey));
  }, [surfaceKey]);

  const place = useCallback((subject: ThreadCollapseSubject): ThreadReadState => {
    const prior = placements.current.get(subject.threadId);
    // A status change is what re-asserts the rule, so it takes the answer fresh;
    // anything else can only make the standing answer more cautious.
    if (prior === undefined || prior.status !== subject.status) {
      placements.current.set(subject.threadId, {
        status: subject.status,
        readState: subject.readState,
        holders: prior?.holders ?? 0,
      });
      return subject.readState;
    }
    prior.readState = strongerReadState(prior.readState, subject.readState);
    return prior.readState;
  }, []);

  /** The subject as this surface treats it — read-only, for the callbacks. */
  const placed = useCallback((subject: ThreadCollapseSubject): ThreadCollapseSubject => {
    const prior = placements.current.get(subject.threadId);
    if (prior === undefined || prior.status !== subject.status) return subject;
    return prior.readState === subject.readState
      ? subject
      : { ...subject, readState: prior.readState };
  }, []);

  const hold = useCallback((threadId: string): (() => void) => {
    const entry = placements.current.get(threadId);
    if (entry !== undefined) entry.holders += 1;
    return () => {
      const held = placements.current.get(threadId);
      if (held === undefined) return;
      held.holders -= 1;
      if (held.holders > 0) return;
      // Deferred: a chip becoming a margin card releases and re-holds inside one
      // commit, and only a real departure is still at zero by the microtask.
      queueMicrotask(() => {
        const now = placements.current.get(threadId);
        if (now !== undefined && now.holders <= 0) placements.current.delete(threadId);
      });
    };
  }, []);

  /**
   * Persisted by re-reading the blob first, never by writing a cached copy of
   * it: two columns are two providers over one `localStorage` key, and a writer
   * that serialised its own idea of the whole thing would drop the other
   * column's folds every time it saved.
   */
  const commit = useCallback((next: SurfaceOverrides) => {
    latest.current = next;
    setOverrides(next);
    writeCollapseState(withSurface(readCollapseState(), key.current, next));
  }, []);

  const setCollapsed = useCallback(
    (subject: ThreadCollapseSubject, collapsed: boolean) => {
      commit(withOverride(latest.current, subject, collapsed));
    },
    [commit],
  );

  /*
   * `overrides` is a dependency because it is the answer: the value carries
   * `isCollapsed`, and a memo that kept its identity across a fold would leave
   * every panel below rendering the state it was in before the click. Cheap —
   * a surface holds a handful of conversations, and the margin re-cascades on
   * a height change regardless.
   */
  return (
    <Context.Provider
      value={useMemo<ThreadCollapseApi>(
        () => ({
          /*
           * Every answer is about the conversation **as this surface placed
           * it**, not as the latest row describes it — otherwise a highlight
           * click or a jump, which builds its subject straight from a row, would
           * disagree with the panel standing in front of the reader.
           */
          isCollapsed: (subject) => isThreadCollapsed(overrides, placed(subject)),
          setCollapsed,
          toggle: (subject) => {
            setCollapsed(subject, !isThreadCollapsed(latest.current, placed(subject)));
          },
          expand: (subject) => {
            if (isThreadCollapsed(latest.current, placed(subject))) setCollapsed(subject, false);
          },
          observe: (subject) => {
            const next = dropStaleOverride(latest.current, subject);
            if (next !== latest.current) commit(next);
          },
          place,
          hold,
        }),
        [commit, hold, overrides, place, placed, setCollapsed],
      )}
    >
      {children}
    </Context.Provider>
  );
}
