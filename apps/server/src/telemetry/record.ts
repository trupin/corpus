// The ingestion half of SPEC.md §9.4's cost ledger: what a `corpus` invocation
// wrote and printed, written down and nothing else.
//
// §9.4 makes this channel's *cost* part of its contract — "a report that fails
// to arrive costs the command nothing and is never retried" — so the write path
// is deliberately the smallest thing that can be correct: one transaction, one
// prepared INSERT per row, no SELECT, no file, no commit, no queue event, no SSE
// frame (sprint-025 R11). Everything a reader wants from these rows is derived
// at read time by `series.ts`.

import type { InvocationReport, InvocationReportRequest } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";
import { META_TELEMETRY_SINCE } from "../projection/schema.js";

const INSERT_ROW =
  "INSERT INTO telemetry (at_ms, command, wrote_bytes, read_bytes, subject) VALUES (?, ?, ?, ?, ?)";

/**
 * `INSERT OR IGNORE` rather than a read-then-write, so the ledger's start is
 * stamped exactly once and the write path still issues no `SELECT`. `meta`'s
 * primary key does the deciding, in the same transaction as the rows it dates.
 */
const STAMP_SINCE = "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)";

/**
 * The invocations a request carries, whichever of the two forms it used.
 *
 * The single form is a closed object without `invocations`, so the key itself is
 * the discriminator — the contract's union has no tag and needs none.
 */
function invocationsOf(request: InvocationReportRequest): readonly InvocationReport[] {
  return "invocations" in request ? request.invocations : [request];
}

/**
 * The subjects of one invocation, with repeats removed.
 *
 * A repeat is a row that would count the same invocation twice in one
 * document's series — the wire does not forbid `[doc_a, doc_a]`, and a verb
 * that names a document positionally *and* in a flag could produce it. Removing
 * it here is what makes `invocations` a plain `COUNT(*)` at read time: after
 * this, a document appears at most once per invocation, so a row **is** an
 * invocation for that document. Insertion order is kept, because it is the
 * order the caller named them in and nothing here has a better one.
 */
function distinctSubjects(subjects: readonly string[]): readonly string[] {
  return [...new Set(subjects)];
}

/**
 * Records one invocation report or a batch of them (SPEC.md §9.4).
 *
 * **One row per subject.** An invocation naming two documents writes two rows
 * carrying the same instant, command path and byte counts: each document paid
 * the whole command, and a series showing a share of it would answer a question
 * nobody asked. An invocation that named nothing — `corpus search`, `corpus doc
 * list` — writes **one row with a NULL subject** rather than nothing at all. No
 * document's series reads those rows and no route exposes them today, and they
 * are kept anyway so that a workspace-wide figure stays answerable later without
 * asking every CLI in the field to report a second time.
 *
 * **Nothing is refused here.** A subject naming no document is stored as it
 * arrived: the invocation happened, and a document deleted since is not a reason
 * to lose the measurement. The only refusals on this path are the contract's
 * shape refusals, which never reach this function.
 *
 * An empty batch records nothing at all — including the ledger's start stamp,
 * which would otherwise date the workspace's measuring from a request that
 * measured nothing.
 */
export function recordInvocations(
  db: ProjectionDb,
  request: InvocationReportRequest,
  now: () => number,
): void {
  const invocations = invocationsOf(request);
  if (invocations.length === 0) return;

  const insert = db.prepare(INSERT_ROW);
  const stamp = db.prepare(STAMP_SINCE);
  const startedAt = new Date(now()).toISOString();

  db.transaction(() => {
    stamp.run(META_TELEMETRY_SINCE, startedAt);
    for (const invocation of invocations) {
      const at = Date.parse(invocation.at);
      const subjects = distinctSubjects(invocation.subjects);
      if (subjects.length === 0) {
        insert.run(at, invocation.command, invocation.wroteBytes, invocation.readBytes, null);
        continue;
      }
      for (const subject of subjects) {
        insert.run(at, invocation.command, invocation.wroteBytes, invocation.readBytes, subject);
      }
    }
  })();
}
