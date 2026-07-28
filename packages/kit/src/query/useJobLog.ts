import type { JobLogLine } from "@corpus/contract";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { jobKey } from "./keys.js";

/**
 * The console's log pane, and the one place the "no data on the wire" rule
 * (SPEC.md §2.2 rule 3) becomes a data-fetching strategy.
 *
 * The server tails `.corpus/jobs/<eventId>.jsonl` and broadcasts
 * `invalidate {keys: [["jobs", eventId]]}` — **never the lines**. So this is an
 * ordinary `useQuery` keyed on `jobKey(eventId)`: an invalidation makes it
 * refetch, and the refetch is incremental because it passes back the
 * `nextCursor` the previous fetch returned.
 *
 * **The cursor is the deduplication mechanism**, not a client-side line diff.
 * `nextCursor` equals the total line count, so asking for `?cursor=<n>` returns
 * exactly the lines the client does not have — and asking twice (a reconnect
 * mid-stream, a duplicated frame, a manual refetch) returns nothing the second
 * time. There is no comparison of line text anywhere in this file, which is why
 * a job that logs the same sentence twice shows it twice.
 */

export interface JobLogView {
  /** Every line held for this job, oldest first, after the head cap below. */
  readonly lines: readonly JobLogLine[];
  /** Pass back on the next fetch; equals the server's total line count. */
  readonly nextCursor: number;
  /**
   * True once the head of the buffer has been dropped. The pane renders a
   * "…truncated" marker rather than silently pretending the job started here.
   */
  readonly truncated: boolean;
}

/**
 * How many lines a single job keeps in memory and in the DOM.
 *
 * A chatty job can emit far more than a person will ever scroll back through,
 * and the pane is a few hundred pixels tall; the server's own 4 MB file cap is
 * about the file, not about the browser. The oldest lines go first because the
 * console is a *tail*.
 */
export const MAX_BUFFERED_LOG_LINES = 5000;

export const EMPTY_JOB_LOG: JobLogView = { lines: [], nextCursor: 0, truncated: false };

/** Applies the head cap, preserving the marker once it has been earned. */
export function capLogLines(
  lines: readonly JobLogLine[],
  nextCursor: number,
  alreadyTruncated: boolean,
): JobLogView {
  if (lines.length <= MAX_BUFFERED_LOG_LINES) {
    return { lines, nextCursor, truncated: alreadyTruncated };
  }
  return {
    lines: lines.slice(lines.length - MAX_BUFFERED_LOG_LINES),
    nextCursor,
    truncated: true,
  };
}

export interface UseJobLogOptions {
  /**
   * Off while the drawer is collapsed (SPEC.md §11): nothing is visible, so
   * nothing should be fetched and no invalidation should cost a request.
   */
  readonly enabled?: boolean;
}

/**
 * `GET /api/jobs/{id}/log?cursor=` — the selected job's lines (SPEC.md §7).
 *
 * `eventId` is nullable so the empty console (no jobs at all) can call the hook
 * unconditionally; the query is simply disabled.
 */
export function useJobLog(
  eventId: string | null,
  options: UseJobLogOptions = {},
): UseQueryResult<JobLogView, Error> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  const enabled = (options.enabled ?? true) && eventId !== null;
  const key = jobKey(eventId ?? "");

  return useQuery<JobLogView, Error>({
    queryKey: key,
    enabled,
    queryFn: async ({ signal }) => {
      const id = eventId ?? "";
      const held = queryClient.getQueryData<JobLogView>(key) ?? EMPTY_JOB_LOG;
      const page = await client.getJobLog(id, held.nextCursor, { signal });

      // The log shrank: the file was rotated or replaced under us, so the held
      // cursor now points past its end and every line we hold is suspect. Start
      // over rather than appending onto a prefix that no longer exists.
      if (page.nextCursor < held.nextCursor) {
        const full = await client.getJobLog(id, 0, { signal });
        return capLogLines(full.lines, full.nextCursor, false);
      }

      if (page.lines.length === 0) {
        // Nothing new. Returning the held view keeps referential identity for
        // the common case — an invalidation that raced ahead of the append.
        return held.nextCursor === page.nextCursor
          ? held
          : capLogLines(held.lines, page.nextCursor, held.truncated);
      }

      return capLogLines([...held.lines, ...page.lines], page.nextCursor, held.truncated);
    },
  });
}
