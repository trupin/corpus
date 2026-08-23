import { DOC_STATUSES } from "@corpus/contract";
import { docsListKey, useCorpusClient, type DocsFilter } from "@corpus/kit";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Board } from "./boardDoc";
import { compileQuery, readStoredQuery } from "./viewDoc";

/**
 * How many documents a kanban's scope holds that **none of its columns show**
 * (UI-152's edge case: "so nothing silently vanishes").
 *
 * A kanban's columns are its stages, so a document whose `stage` is a word the
 * board does not draw is inside the board's scope and in no column of it. Left
 * unsaid, that document is simply gone from the board a person is using to see
 * their work, and nothing on the screen distinguishes it from a document that
 * does not exist. So the bar counts them and says the number.
 *
 * ## Two cheap counts, not a scan
 *
 * Each request below asks for `limit=1` and reads `page.total` — the count is
 * the server's, and no row is transferred to produce it.
 *
 * - **A kanban over `stage`** is one subtraction: everything in scope, minus
 *   everything in scope whose stage is one of the board's *or* absent, which is
 *   exactly what `stage=,a,b,c` selects (CONTRACT-074's null sentinel). Two
 *   requests, whatever the board's size.
 * - **A kanban over `status`** cannot OR — `status` takes one value — so it asks
 *   for the statuses the board does **not** list, of which there are at most
 *   two. A board listing all three (the seed's) asks nothing at all and is
 *   answered `0` without a round trip.
 *
 * `includeArchived` is on for the `stage` count, per SPEC.md §5: a board's scope
 * includes archived documents, because a document in a stage mapped to
 * `archived` is still in the kanban.
 *
 * ## `null` means *not known*, and it is not `0`
 *
 * A count that has not arrived says nothing. Reporting `0` for it would be this
 * surface claiming a corpus it has not asked about — the same rule the reflection
 * clock follows, and the reason the hint's clause is absent rather than reading
 * "0 documents" for one round trip on every load.
 */

/** One counting query and which way it goes into the total. */
interface Count {
  readonly filter: DocsFilter;
  readonly sign: 1 | -1;
}

/** `limit=1`: the answer is `page.total`, and no row needs to travel. */
const ONE = 1;

export function strayCounts(board: Board | null): readonly Count[] {
  const kanban = board?.kanban ?? null;
  if (board === null || kanban === null) return [];
  const scope = compileQuery(readStoredQuery(board.query).stored).filter;

  if (kanban.field === "stage") {
    const inScope: DocsFilter = { ...scope, includeArchived: true, limit: ONE };
    return [
      { filter: inScope, sign: 1 },
      { filter: { ...inScope, stage: `,${kanban.stages.join(",")}` }, sign: -1 },
    ];
  }

  return DOC_STATUSES.filter((status) => !kanban.stages.includes(status)).map((status) => ({
    filter: { ...scope, status, limit: ONE },
    sign: 1 as const,
  }));
}

export function useStrayStages(board: Board | null): number | null {
  const client = useCorpusClient();
  const counts = useMemo(() => strayCounts(board), [board]);

  const results = useQueries({
    queries: counts.map((count) => ({
      queryKey: docsListKey(count.filter as Record<string, unknown>),
      queryFn: ({ signal }: { signal: AbortSignal }) => client.listDocs(count.filter, { signal }),
    })),
  });

  if (counts.length === 0) return board?.kanban === null ? null : 0;
  let total = 0;
  for (const [index, result] of results.entries()) {
    const page = result.data?.page;
    if (page === undefined) return null;
    total += (counts[index]?.sign ?? 1) * page.total;
  }
  // A negative total means the two counts disagree — a document counted in a
  // column and not in scope, which the server's own filters make impossible. It
  // is reported as nothing rather than as a negative claim.
  return total > 0 ? total : 0;
}
