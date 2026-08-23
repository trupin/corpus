import { useEffect, useState, type RefObject } from "react";

/**
 * Which columns are on screen (SPEC.md §10, rider 4: "a tab for a column off
 * screen is dimmed").
 *
 * **An observer, not a scroll listener.** The board is a horizontal scroller
 * that can hold twenty columns, and a listener would run the same measurement
 * on every frame of every scroll for a result that changes twice. An
 * `IntersectionObserver` rooted at the board costs nothing while the board is
 * still and reports only the columns that crossed the line.
 *
 * **What cannot be measured is not claimed.** Where the API is absent — jsdom,
 * an old engine — every column reads as seen rather than as off screen. A
 * dimmed tab is an assertion about where the board is scrolled to, and a
 * surface that has observed nothing must not make it (the standing rule from
 * UI-097: the absence of evidence is not evidence).
 */

/** Half in view is in view — `design/navigation.html`'s `watchVisibility`. */
export const SEEN_RATIO = 0.5;

export function useColumnVisibility(
  board: RefObject<HTMLElement | null>,
  keys: readonly string[],
): ReadonlySet<string> {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set<string>());
  /*
   * The dependency is the key list *by value*: the effect must re-observe when
   * a column opens or closes, and only then. The array itself is a fresh
   * identity on every render of the board, which is most keystrokes.
   */
  const signature = keys.join(",");

  useEffect(() => {
    const root = board.current;
    if (root === null) return undefined;

    const live = new Set(signature === "" ? [] : signature.split(","));

    if (typeof IntersectionObserver !== "function") {
      setSeen(live);
      return undefined;
    }

    // A key that left the board takes its verdict with it, so a slot id that
    // comes back is re-observed rather than inheriting the old answer.
    setSeen((current) => {
      const kept = new Set([...current].filter((key) => live.has(key)));
      return kept.size === current.size ? current : kept;
    });

    const observer = new IntersectionObserver(
      (entries) => {
        setSeen((current) => {
          const next = new Set(current);
          let changed = false;
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset["col"];
            if (key === undefined) continue;
            const isSeen = entry.intersectionRatio >= SEEN_RATIO;
            if (isSeen === next.has(key)) continue;
            if (isSeen) next.add(key);
            else next.delete(key);
            changed = true;
          }
          return changed ? next : current;
        });
      },
      { root, threshold: [SEEN_RATIO] },
    );

    for (const column of root.querySelectorAll<HTMLElement>(".col[data-col]")) {
      observer.observe(column);
    }

    return () => {
      observer.disconnect();
    };
  }, [board, signature]);

  return seen;
}
