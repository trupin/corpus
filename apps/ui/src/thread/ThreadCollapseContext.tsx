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
  surfaceOverrides,
  withOverride,
  withSurface,
  writeCollapseState,
  type SurfaceOverrides,
  type ThreadCollapseSubject,
} from "./threadCollapse";

/**
 * One reading surface's folds, held where SPEC.md §11 says they belong: in the
 * browser, per reader, never on disk.
 *
 * **Per reader is the point, not an implementation detail.** "Two columns
 * showing the same document keep their own" is spelled out in the signed text,
 * and it falls straight out of §11's existing division — a column's scroll
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
}

/**
 * The fallback when no surface has been provided.
 *
 * Applies the rule and forgets every gesture, which is the honest answer for a
 * conversation rendered outside a reader: there is no surface for a fold to
 * belong to. Component tests that render a card on its own get the rule, not a
 * crash.
 */
const UNHOSTED: ThreadCollapseApi = {
  isCollapsed: (subject) => isThreadCollapsed({}, subject),
  setCollapsed: () => undefined,
  toggle: () => undefined,
  expand: () => undefined,
  observe: () => undefined,
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

  // A surface that changes identity mid-life starts from that surface's own
  // record rather than inheriting the previous one's.
  const key = useRef(surfaceKey);
  useEffect(() => {
    if (key.current === surfaceKey) return;
    key.current = surfaceKey;
    setOverrides(surfaceOverrides(readCollapseState(), surfaceKey));
  }, [surfaceKey]);

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
          isCollapsed: (subject) => isThreadCollapsed(overrides, subject),
          setCollapsed,
          toggle: (subject) => {
            setCollapsed(subject, !isThreadCollapsed(latest.current, subject));
          },
          expand: (subject) => {
            if (isThreadCollapsed(latest.current, subject)) setCollapsed(subject, false);
          },
          observe: (subject) => {
            const next = dropStaleOverride(latest.current, subject);
            if (next !== latest.current) commit(next);
          },
        }),
        [commit, overrides, setCollapsed],
      )}
    >
      {children}
    </Context.Provider>
  );
}
