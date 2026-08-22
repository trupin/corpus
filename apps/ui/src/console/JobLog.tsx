import type { JobLogView } from "@corpus/kit";
import { useCallback, useLayoutEffect, useRef, type ReactElement } from "react";
import { isErrorLine } from "./consoleModel";

/**
 * The selected job's log lines (SPEC.md §7, §10).
 *
 * ## Auto-scroll discipline
 *
 * The pane tails: while it is pinned to the bottom, new lines scroll it. The
 * moment the user scrolls up it stops, because yanking the viewport away from
 * something someone is reading is the failure mode a live log has. Scrolling
 * back to the bottom re-pins.
 *
 * `scrollTop = scrollHeight` rather than `scrollIntoView`: the latter scrolls
 * every scrollable ancestor, which in a 210 px drawer means moving the page.
 *
 * ## Why there is no rAF batch here
 *
 * Lines do not arrive one at a time. The server tails the job file and debounces
 * its `invalidate` frames; one refetch then returns every line that accumulated
 * in that window as a single array. A job logging a hundred lines a second
 * therefore costs a handful of renders per second, upstream of this component —
 * batching again here would only add a frame of latency.
 */

/** How close to the bottom still counts as "at the bottom". */
export const PIN_THRESHOLD_PX = 24;

export function isScrolledToBottom(element: {
  readonly scrollHeight: number;
  readonly scrollTop: number;
  readonly clientHeight: number;
}): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < PIN_THRESHOLD_PX;
}

export interface JobLogProps {
  readonly log: JobLogView;
}

export function JobLog({ log }: JobLogProps): ReactElement {
  const { lines, truncated } = log;
  const pane = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  // `nextCursor` is the server's total line count, so this is the absolute
  // number of the first line still held — a stable identity that survives the
  // head of the buffer being dropped.
  const firstLineNumber = log.nextCursor - lines.length;

  const onScroll = useCallback(() => {
    const element = pane.current;
    if (element === null) return;
    pinned.current = isScrolledToBottom(element);
  }, []);

  useLayoutEffect(() => {
    const element = pane.current;
    if (element === null || !pinned.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <div className="job-log-lines" ref={pane} onScroll={onScroll} aria-label="Job log">
      {truncated ? <div className="truncated">…truncated</div> : null}
      {lines.map((line, index) => (
        <div
          // Log lines repeat verbatim and carry no id, so their absolute
          // position in the append-only file is their identity.
          key={firstLineNumber + index}
          className={isErrorLine(line.line) ? "err" : undefined}
        >
          {line.line}
        </div>
      ))}
    </div>
  );
}
