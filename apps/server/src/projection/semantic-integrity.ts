/**
 * `corpus db doctor`'s semantic half (SPEC.md §11, Retrieval Phase B):
 *
 * > Doctor's coverage extends to the semantic index (§9.1): it fails on
 * > **drift** — a chunk whose recorded document, heading path, or content no
 * > longer matches the files, or an index mixing more than one provider/model
 * > identity — but treats **pending asynchronous indexing as staleness, not
 * > drift**.
 *
 * The whole pass is **SQL over the projection and nothing else**: it opens no
 * file, hashes nothing, and spawns no process. That is a requirement rather than
 * an optimisation — `stats.hashed` is doctor's published promise that a warm
 * workspace re-reads nothing (`doctor.ts`'s size+mtime short-circuit), and a
 * semantic pass that re-chunked every document to verify its ids would make
 * every `corpus db doctor` cost a full re-projection.
 *
 * **What that leaves out, deliberately.** Chunk rows are written inside
 * `projectDocument`'s transaction, alongside the `search` row and the
 * `file_hashes` entry that doctor's content check already compares
 * (`semantic/chunks.ts`). So for an untampered database "the chunk rows no
 * longer match the file" is, byte for byte, the `content_mismatch` the existing
 * pass already reports — re-deriving chunk ids here would re-answer a question
 * doctor has already answered, at the price of reading every document. What this
 * pass adds is the drift the existing one structurally *cannot* see: a chunk
 * addressed to a document the projection does not have, and a chunk whose two
 * rows disagree with each other. Both are unreachable through the projector and
 * reachable through a hand-edit, a partial write, or a bug — which is the set
 * `doctor` exists for.
 *
 * **Pending is not here at all**, and neither is `failed` as a verdict. A
 * backlog is `corpus index status`'s business (§11, signed), and it is what
 * makes `corpus db rebuild && corpus db doctor` clean the instant the rebuild
 * returns even though embeddings are still draining. `failed > 0` earns a
 * report-only **warning** instead (sprint-021 Open Conflict 9): it will never
 * drain on its own, so an operator should hear about it, and a warning is the
 * one surface that says so without moving a verdict or an exit code.
 */

import { recordedIdentities } from "../semantic/embeddings.js";
import { checkIndexIdentity } from "../semantic/identity.js";
import type { EffectiveModel } from "../semantic/state.js";
import { indexCounts } from "../semantic/worker.js";
import type { ProjectionDb } from "./db.js";
import type { Drift, DoctorWarning } from "./doctor.js";

/**
 * How many chunk-level findings one report lists.
 *
 * A `chunks` table disagreeing with itself disagrees at scale — one bad write
 * touches every chunk of a document, one bad rebuild touches the corpus — and a
 * drift array with 40,000 entries is a report nobody reads and a response body
 * nobody wants. Past the limit the pass says how many more there were, in the
 * shape `unindexable.ts` already uses for the same problem.
 */
export const SEMANTIC_DRIFT_LIMIT = 50;

export interface SemanticIntegrityReport {
  readonly drift: readonly Drift[];
  readonly warnings: readonly DoctorWarning[];
}

type ChunkRow = {
  readonly ref: string;
  readonly ord: number;
  readonly chunk_id: string;
  readonly doc_id: string;
  readonly heading_path: string;
};

type SearchRow = {
  readonly ref: string;
  readonly ord: number;
  readonly chunk_id: string;
  readonly heading_path: string;
};

/** `(ref, ord)` is `chunks`'s primary key, and the pairing `chunk_search` mirrors. */
const positionKey = (ref: string, ord: number): string => `${ref}\0${String(ord)}`;

/**
 * Chunk rows whose `doc_id` names no `documents` row.
 *
 * Deleting a document deletes its chunks in the same statement sequence
 * (`project-document.ts`), so this is unreachable through the projector — and it
 * is exactly "a chunk whose recorded document no longer matches the files".
 * Reported as `orphan_row`, the kind whose published meaning is a row for
 * something that no longer exists; sprint-021 Open Conflict 6 ruled that the
 * semantic pass reuses existing kinds rather than adding one, because `DRIFT_KINDS`
 * is closed on the wire and a kind the contract has never heard of is a verdict
 * a client cannot render.
 */
function checkOrphanedChunks(db: ProjectionDb, drift: Drift[]): void {
  const rows = db
    .prepare(
      `SELECT c.doc_id AS doc_id, COUNT(*) AS n
         FROM chunks c LEFT JOIN documents d ON d.id = c.doc_id
        WHERE d.id IS NULL
        GROUP BY c.doc_id
        ORDER BY c.doc_id
        LIMIT ?`,
    )
    .all(SEMANTIC_DRIFT_LIMIT + 1) as { doc_id: string; n: number }[];

  for (const row of rows.slice(0, SEMANTIC_DRIFT_LIMIT)) {
    drift.push({
      kind: "orphan_row",
      detail:
        `${String(row.n)} chunk row(s) are addressed to document ${row.doc_id}, which the ` +
        "projection does not have — no file under any root produces it",
    });
  }
  if (rows.length > SEMANTIC_DRIFT_LIMIT) {
    drift.push({
      kind: "orphan_row",
      detail:
        `more than ${String(SEMANTIC_DRIFT_LIMIT)} documents have orphaned chunk rows; the ` +
        "first are listed. Re-derive the projection with `corpus db rebuild`",
    });
  }
}

/**
 * Chunk rows whose `chunk_search` twin is missing or describes something else.
 *
 * The two tables are written and deleted together, one row apiece, inside one
 * transaction — so a `chunks` row with no twin, or a twin carrying a different
 * content-addressed id or a different heading path, is a projection that
 * disagrees with itself about what a passage is and where it sits. Both halves
 * are read once and compared in memory rather than joined in SQL:
 * `chunk_search` is FTS5 with every column but `body` `UNINDEXED`, so a join on
 * `(ref, ord)` is a full scan per row.
 */
function checkChunkPairing(db: ProjectionDb, drift: Drift[]): void {
  const searchRows = db
    .prepare("SELECT ref, ord, chunk_id, heading_path FROM chunk_search")
    .all() as SearchRow[];
  const twins = new Map(searchRows.map((row) => [positionKey(row.ref, row.ord), row]));

  const chunkRows = db
    .prepare("SELECT ref, ord, chunk_id, doc_id, heading_path FROM chunks ORDER BY ref, ord")
    .all() as ChunkRow[];

  const paths = new Map(
    (db.prepare("SELECT id, path FROM documents").all() as { id: string; path: string }[]).map(
      (row) => [row.id, row.path],
    ),
  );

  let found = 0;
  const seen = new Set<string>();
  for (const chunk of chunkRows) {
    const key = positionKey(chunk.ref, chunk.ord);
    seen.add(key);
    const twin = twins.get(key);
    const reason =
      twin === undefined
        ? `has no chunk_search row, so its text is not in the index it addresses`
        : twin.chunk_id !== chunk.chunk_id
          ? `is recorded as ${chunk.chunk_id} but its chunk_search row says ${twin.chunk_id}; ` +
            "the id is a hash of the document, heading path and content, so the two rows " +
            "describe different text"
          : twin.heading_path !== chunk.heading_path
            ? `is recorded under "${chunk.heading_path}" but its chunk_search row says ` +
              `"${twin.heading_path}"`
            : null;
    if (reason === null) continue;

    found += 1;
    if (found > SEMANTIC_DRIFT_LIMIT) continue;
    const path = paths.get(chunk.doc_id);
    drift.push({
      kind: "content_mismatch",
      ...(path === undefined ? {} : { path }),
      detail: `chunk ${chunk.ref}#${String(chunk.ord)} ${reason}`,
    });
  }

  // The mirror image: a `chunk_search` row no `chunks` row claims. It is invisible
  // to every lookup keyed by `chunks` — including the pending set and the worker's
  // claim — yet it still answers chunk-granular address queries, which is how a
  // stale row makes ranked search name a passage that is not there any more.
  let strays = 0;
  for (const row of searchRows) {
    if (seen.has(positionKey(row.ref, row.ord))) continue;
    strays += 1;
    if (strays > SEMANTIC_DRIFT_LIMIT) break;
    drift.push({
      kind: "orphan_row",
      detail: `chunk_search row ${row.ref}#${String(row.ord)} has no chunks row`,
    });
  }

  if (found > SEMANTIC_DRIFT_LIMIT || strays > SEMANTIC_DRIFT_LIMIT) {
    drift.push({
      kind: "content_mismatch",
      detail:
        `${String(found)} chunk row(s) and ${String(strays)} chunk_search row(s) disagree; the ` +
        `first ${String(SEMANTIC_DRIFT_LIMIT)} of each are listed. Re-derive the projection ` +
        "with `corpus db rebuild`",
    });
  }
}

/**
 * Whether every vector in the index was produced by the model that is effective
 * now (SPEC.md §9.1: "one index, one model — results from different models are
 * never mixed").
 *
 * `checkIndexIdentity` is the pure check and it is not re-implemented here; this
 * function only decides which of its five answers is drift:
 *
 * - **`mixed` — drift.** §11 names it verbatim, and it needs no resolution at
 *   all: two identities in one table is a fact about the rows.
 * - **`mismatch` — drift.** Every vector was produced by a model that is not the
 *   effective one, so the index reports `indexed == total` while nothing in it
 *   can be compared against a fresh query. The counts are honest under their own
 *   definitions and the whole is a lie; this is the case SERVER-044 flagged.
 * - **`unresolved` — a warning, not drift.** Nothing can embed right now, and
 *   the vectors are untouched and valid (`semantic/identity.ts`). It is an
 *   environment fact, not a disagreement between files and rows — and failing on
 *   it would break §11's standing `rebuild && doctor` invariant permanently,
 *   because `corpus db rebuild` carries embeddings over by design (Open Conflict
 *   5), so no rebuild could ever clear the verdict.
 * - **`no-index` / `match` — nothing.**
 */
function checkIdentity(
  db: ProjectionDb,
  effective: EffectiveModel,
  drift: Drift[],
  warnings: DoctorWarning[],
): void {
  const recorded = recordedIdentities(db);
  if (recorded.length === 0) return;

  const check = checkIndexIdentity(
    recorded,
    effective.kind === "identity" ? effective.identity : null,
  );

  switch (check.kind) {
    case "mixed":
      drift.push({
        kind: "count_mismatch",
        detail:
          "the semantic index holds vectors from more than one model: " +
          `${check.identities.join(", ")}. Results from different models are never mixed ` +
          "(SPEC.md §9.1); re-pick one with `corpus index rebuild`",
      });
      return;
    case "mismatch":
      drift.push({
        kind: "count_mismatch",
        detail:
          `every vector in the semantic index was produced by ${check.recorded}, and the ` +
          `effective model is ${check.resolved}. The index reports itself covered while none ` +
          "of it can be compared against a fresh query; `corpus index rebuild` re-picks and " +
          "re-embeds",
      });
      return;
    case "unresolved":
      if (effective.kind !== "none") return;
      warnings.push({
        kind: "semantic_index_unusable",
        detail:
          `the semantic index holds vectors from ${check.recorded} and nothing can embed right ` +
          `now: ${effective.detail}. The vectors are untouched and still valid — search is ` +
          "lexical until an embedding provider is available again (`corpus index status`)",
      });
      return;
    default:
      return;
  }
}

/**
 * The semantic index's contribution to a `doctor` run.
 *
 * `effective` is what the *caller* can resolve, which is why it is a parameter
 * rather than something read here: `doctor` opens a read-only connection and
 * must stay runnable with no server at all, so a standalone invocation passes
 * `{ kind: "unknown" }` and the identity comparison is simply not made.
 */
export function checkSemanticIndex(
  db: ProjectionDb,
  effective: EffectiveModel,
): SemanticIntegrityReport {
  const drift: Drift[] = [];
  const warnings: DoctorWarning[] = [];

  checkOrphanedChunks(db, drift);
  checkChunkPairing(db, drift);
  checkIdentity(db, effective, drift, warnings);

  const counts = indexCounts(db);
  if (counts.failed > 0) {
    warnings.push({
      kind: "semantic_index_failed",
      detail:
        `${String(counts.failed)} chunk(s) failed to embed and are no longer being retried. ` +
        "Unlike a pending backlog this does not drain on its own — fix what made them fail and " +
        "run `corpus index rebuild` to re-queue them (`corpus index status` for the counts)",
    });
  }

  return { drift, warnings };
}
