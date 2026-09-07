// The read half of SPEC.md §9.4's cost ledger: one document's cost over time,
// beside the one present-tense number the panel draws it against.
//
// Every figure here is derived at request time from the raw rows `record.ts`
// appended. There is no aggregate table and no second source of truth for one
// number (sprint-025 O3): at one row per invocation-subject, and with retention
// bounding how many of them survive, the read is an indexed group-by over at
// most a few thousand rows.

import {
  estimateTokens,
  type CostBucket,
  type CostGranularity,
  type DocumentCost,
} from "@corpus/contract";
import { notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import { META_TELEMETRY_SINCE } from "../projection/schema.js";

/**
 * The granularity this server buckets at, stated on every response because a
 * caller must never infer one from two boundaries.
 *
 * **Daily**, and the choice follows the question §9.4 asks: *is working with
 * this document getting more expensive as it grows?* That is a trend over weeks
 * and months, and an hourly series would draw a workspace's sleep schedule
 * across it. A day is also the coarsest bucket that still shows a single heavy
 * session as a bump rather than smearing it into a week.
 */
export const COST_GRANULARITY: CostGranularity = "day";

/** One bucket's span in milliseconds — the granularity above, as arithmetic. */
export const BUCKET_MS = 86_400_000;

/**
 * Buckets are UTC days, aligned to the epoch, so `at_ms / BUCKET_MS` is the
 * bucket index. SQLite's integer division truncates toward zero rather than
 * flooring, which differs for a negative `at_ms` — a timestamp before 1970,
 * which no `corpus` invocation has but which the wire does not forbid. The
 * `% ... < 0` term is the correction, and it costs one comparison per row.
 */
const BUCKET_INDEX_SQL = `(at_ms / ${String(BUCKET_MS)} - (at_ms % ${String(BUCKET_MS)} < 0))`;

/**
 * The document's existence and its current size, in one statement.
 *
 * `file_hashes.size` is the file's byte length as the projection last wrote it,
 * frontmatter included (`projection/project-document.ts`) — so the reference
 * line costs a join rather than a `stat`, and this whole request performs **no
 * filesystem read** (sprint-025 P11). The join is a `LEFT` one: a row can exist
 * for a document whose file the projector never hashed, and answering `0` bytes
 * for it is better than answering `404` for a document that plainly exists.
 */
const SIZE_SQL = `
SELECT f.size AS size
FROM documents d
LEFT JOIN file_hashes f ON f.path = d.path
WHERE d.id = ?`;

/**
 * One row per (bucket, command), which is the grain the contract fixes the
 * token estimate at. Ordering is by bucket so the assembly below walks the
 * series once.
 */
const SERIES_SQL = `
SELECT ${BUCKET_INDEX_SQL} AS bucket,
       command AS command,
       SUM(wrote_bytes) AS wrote_bytes,
       SUM(read_bytes) AS read_bytes,
       COUNT(*) AS invocations
FROM telemetry
WHERE subject = ?
GROUP BY bucket, command
ORDER BY bucket`;

interface SeriesRow {
  readonly bucket: number;
  readonly command: string;
  readonly wrote_bytes: number;
  readonly read_bytes: number;
  readonly invocations: number;
}

/** The mutable accumulator one bucket is built in, before it becomes a `CostBucket`. */
interface BucketDraft {
  wroteTokens: number;
  readTokens: number;
  invocations: number;
  readonly byCommand: Record<string, number>;
}

const emptyDraft = (): BucketDraft => ({
  wroteTokens: 0,
  readTokens: 0,
  invocations: 0,
  byCommand: {},
});

/**
 * Folds one (bucket, command) group into its bucket, converting **once per
 * command per direction** — the grain `CostBucketSchema` fixes.
 *
 * Rounding is not additive, so this is the only place `estimateTokens` may be
 * called: every coarser figure the response publishes is a plain sum of these
 * whole tokens. That is what makes `byCommand` add up to `wroteTokens +
 * readTokens` exactly, which is the one arithmetic error a reader of a panel is
 * guaranteed to notice.
 *
 * A command whose two directions both estimate to zero gets **no key** rather
 * than a zero, as the contract's description says — and because it contributes
 * nothing, omitting it leaves the sums untouched.
 */
function foldGroup(draft: BucketDraft, row: SeriesRow): void {
  const wrote = estimateTokens(row.wrote_bytes);
  const read = estimateTokens(row.read_bytes);
  draft.wroteTokens += wrote;
  draft.readTokens += read;
  draft.invocations += row.invocations;
  const spent = wrote + read;
  if (spent > 0) draft.byCommand[row.command] = (draft.byCommand[row.command] ?? 0) + spent;
}

const bucketAt = (index: number, draft: BucketDraft | undefined): CostBucket => ({
  from: new Date(index * BUCKET_MS).toISOString(),
  to: new Date((index + 1) * BUCKET_MS).toISOString(),
  wroteTokens: draft?.wroteTokens ?? 0,
  readTokens: draft?.readTokens ?? 0,
  invocations: draft?.invocations ?? 0,
  byCommand: draft?.byCommand ?? {},
});

/** When this workspace's ledger started collecting, or `null` when it never has. */
function measuringSince(db: ProjectionDb): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(META_TELEMETRY_SINCE) as
    { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * A document's cost over time (SPEC.md §9.4), bucketed daily and bounded by
 * `limit`.
 *
 * Throws the contract's `404` for an id the projection has never heard of.
 * Threads are documents, so a `th_*` id answers that thread's own series — and
 * a thread's cost is deliberately **not** rolled up into its parent, because
 * §9.4 attributes cost to what the invocation *named*.
 *
 * ## The series is contiguous, empty buckets included
 *
 * Buckets run from the document's oldest surviving measurement to today, with
 * nothing skipped. A day nobody touched the document is a real answer — a zero
 * — and dropping it would turn a quiet week into a hole in the chart that a
 * reader would take for a gap in the data. The last bucket is today's and may
 * still be filling.
 *
 * A document nothing has been measured against answers with **no buckets at
 * all**, never a series of zeros to plot: "nothing measured" and "measured, and
 * it cost nothing" are different claims, and only the first one is true.
 *
 * ## What bounds the length
 *
 * Retention does, before `limit` ever has to. Rows older than the retention
 * window are pruned (`retention.ts`), so a series is at most that many days
 * long however old the document is — which is why the default bound is
 * comfortably past it and `truncated` is normally false. `limit` still cuts
 * when a caller names a smaller one, and it keeps the **newest** buckets.
 */
export function documentCost(
  db: ProjectionDb,
  id: string,
  limit: number,
  now: number,
): DocumentCost {
  const document = db.prepare(SIZE_SQL).get(id) as { size: number | null } | undefined;
  if (document === undefined) throw notFound(`no document with id ${id}`);

  const rows = db.prepare(SERIES_SQL).all(id) as SeriesRow[];
  const drafts = new Map<number, BucketDraft>();
  for (const row of rows) {
    let draft = drafts.get(row.bucket);
    if (draft === undefined) {
      draft = emptyDraft();
      drafts.set(row.bucket, draft);
    }
    foldGroup(draft, row);
  }

  const shared = {
    granularity: COST_GRANULARITY,
    sizeBytes: document.size ?? 0,
    measuringSince: measuringSince(db),
  };
  if (drafts.size === 0) return { ...shared, buckets: [], total: 0, truncated: false };

  const indexes = [...drafts.keys()];
  const oldest = Math.min(...indexes);
  // Today, unless a row is stamped later than that — a clock that ran ahead
  // must not produce a series that stops before its own newest measurement.
  const newest = Math.max(Math.floor(now / BUCKET_MS), ...indexes);
  const total = newest - oldest + 1;
  const first = Math.max(oldest, newest - limit + 1);

  const buckets: CostBucket[] = [];
  for (let index = first; index <= newest; index += 1) {
    buckets.push(bucketAt(index, drafts.get(index)));
  }
  return { ...shared, buckets, total, truncated: total > buckets.length };
}
