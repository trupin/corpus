// `GET /api/docs/{id}/related` — expansion from a known document (SPEC.md §7
// Retrieval discipline, §9.2).
//
// Retrieval's other half. Ranked search answers "where is this subject";
// `related` answers "having found this document, what else bears on it" — and
// in Phase A the only graph there is to answer it with is the projection's
// `links` table, which the projector fills from every `[[ref]]` in a body and
// in every turn (SPEC.md §9.1).
//
// Three properties of that table shape this query, and none of them is
// incidental:
//
// - **A link row is a pair and nothing else** — no link text, no position, no
//   resolved flag. So relatedness here is direction and reciprocity, and
//   nothing finer. A richer ranking needs a richer table, which is a projection
//   migration and a different issue.
// - **It stores references to documents that do not exist**, deliberately:
//   §5 makes referencing a not-yet-created document legitimate. The join to
//   `documents` is therefore an INNER join and a dangling reference is simply
//   not a row — handing the agent an id it cannot then read would be worse than
//   omitting it.
// - **A `[[ref]]` typed in a thread reply is a row keyed on the thread's own
//   document id.** Threads therefore appear in related sets, and that is the
//   decision rather than an accident: a thread *is* a document (§6), it is
//   readable by the same `corpus doc show`, and the conversation that referred
//   to a document is very often the most useful thing near it. Excluding
//   threads would need a type predicate §9.2 does not authorize and would hide
//   the corpus's most recent thinking about the document being expanded from.
//
// Reads two tables and writes nothing: a pure projection read like
// the collection query it sits beside.
//
// **Retrieval Phase B adds the second graph** (SPEC.md §9.1, §9.2). Beside the
// `[[ref]]` edges above, a document's chunk vectors name the documents that
// *read* like it without citing it — which is the half of "what else bears on
// this" a reference graph structurally cannot answer. The two ranked lists are
// fused the way ranked search fuses its own (`search/fusion.ts`), and the
// `relation` field, carried in the frozen enum since CONTRACT-022, finally
// distinguishes them: `linked`, `similar`, or `both`.
//
// The Phase A guarantees survive the addition unchanged, and each is enforced in
// the same place it was before: never itself (`id <> @id` in the CTE, and the
// scan's own `excludeDocId`), never a dangling reference (the INNER join), never
// an archived neighbour by default (the shared `notArchivedSql` fragment, handed
// to the scan as its scope so both halves exclude the same rows). With no usable
// semantic index there is one list, fusing one list re-derives it, and the
// answer is byte-identical to Phase A's.

import type { RelatedDoc, RelatedDocs, RelatedQuery, Relation } from "@corpus/contract";
import { toOneLine } from "../core/one-line.js";
import { notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import { fuseRankings, overFetchLimit } from "../search/fusion.js";
import type { SemanticOutcome, SemanticRetrieval } from "../semantic/index.js";
import { notArchivedSql } from "./filters.js";
import { findDocumentRow } from "./read.js";

/**
 * Neighbours in one statement.
 *
 * `edges` is the union of the two directions, each row carrying which direction
 * it came from; `n` folds them per neighbour, so a pair linked both ways
 * contributes `outgoing = 1, incoming = 1` and outranks a pair linked once.
 * That sum *is* the ranking: **mutual first, then outgoing and backlinks
 * together** — §9.2 gives no reason to prefer one direction over the other, and
 * inventing one would be a scoring model rather than a graph.
 *
 * Ties break by recency then id, the convention every shipped ordering follows
 * (`updated IS NULL` first so an undated document sorts last rather than
 * first — DESC would otherwise put SQLite's NULLs at the top).
 *
 * The self-reference exclusion is in the CTE rather than the outer WHERE: a
 * document may legitimately contain `[[<its own id>]]`, and "most related to
 * this one" never means itself.
 */
const RELATED_SQL = (where: string): string => `WITH edges AS (
    SELECT to_id AS id, 1 AS outgoing, 0 AS incoming FROM links WHERE from_id = @id
    UNION ALL
    SELECT from_id AS id, 0 AS outgoing, 1 AS incoming FROM links WHERE to_id = @id
  ),
  n AS (
    SELECT id, MAX(outgoing) AS outgoing, MAX(incoming) AS incoming
      FROM edges WHERE id <> @id GROUP BY id
  )
SELECT d.id AS id, d.title AS title, d.body_excerpt AS excerpt,
       (n.outgoing + n.incoming) AS strength
  FROM n JOIN documents d ON d.id = n.id
  ${where}
  ORDER BY strength DESC, d.updated IS NULL, d.updated DESC, d.id ASC
  LIMIT @limit`;

interface RawRelated {
  readonly id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly strength: number;
}

export interface RelatedDeps {
  /**
   * Retrieval's semantic half. Absent, the answer is the reference graph alone
   * and the state word is `disabled` — the honest claim for a server with no
   * semantic index wired.
   */
  readonly semantic?: SemanticRetrieval | undefined;
}

const DISABLED: SemanticOutcome = { state: "disabled", docs: [] };

/**
 * The projection's stored `body_excerpt` is 280 characters from the first
 * non-blank one — a multi-line slice, which is what a *list row* wants.
 * Retrieval's row is printed one per line, so it is collapsed and bounded here
 * rather than re-derived from the file: no disk read, and the same one-line rule
 * a search hit's snippet obeys.
 */
const rowOf = (raw: RawRelated, relation: Relation): RelatedDoc => ({
  id: raw.id,
  title: raw.title,
  excerpt: toOneLine(raw.excerpt),
  relation,
});

/**
 * The documents `id` is connected to, ranked. Throws the contract's 404 when
 * `id` names no document — the same shape `GET /api/docs/{id}` produces, since
 * the question is about a document that does not exist either way.
 */
export async function relatedDocs(
  db: ProjectionDb,
  id: string,
  query: RelatedQuery,
  deps: RelatedDeps = {},
): Promise<RelatedDocs> {
  if (findDocumentRow(db, id) === null) throw notFound(`no document with id ${id}`);

  // §10's archived default, through the *same* fragment the collection query
  // and the unread aggregate use: archiving is organizational, so an archived
  // neighbour is a real relation that is simply not what an agent expanding
  // from a live document usually wants first. The semantic half is scoped by
  // the same fragment, so one flag governs both graphs.
  const archived = query.includeArchived === true;
  const semantic =
    deps.semantic === undefined
      ? DISABLED
      : await deps.semantic.forDocument(
          id,
          { where: archived ? "1" : notArchivedSql("d"), params: {} },
          overFetchLimit(query.limit),
        );

  const fetchLimit = semantic.docs.length === 0 ? query.limit : overFetchLimit(query.limit);
  const sql = RELATED_SQL(archived ? "" : `WHERE ${notArchivedSql("d")}`);
  const linked = db.prepare(sql).all({ id, limit: fetchLimit }) as RawRelated[];
  const byId = new Map(linked.map((row) => [row.id, row]));

  // One list means the list itself: fusing a single ranking re-derives its own
  // order, so a workspace with no semantic index answers exactly what Phase A
  // answered — mutual first, then recency, then id.
  const ranked =
    semantic.docs.length === 0
      ? linked.slice(0, query.limit).map((row) => row.id)
      : fuseRankings(
          [linked.map((row) => row.id), semantic.docs.map((match) => match.id)],
          query.limit,
        ).map((entry) => entry.id);

  const similar = new Set(semantic.docs.map((match) => match.id));
  const unlinked = ranked.filter((rowId) => !byId.has(rowId));
  const rows = loadRelatedRows(db, unlinked);
  for (const [rowId, row] of rows) byId.set(rowId, row);

  return {
    related: ranked.flatMap((rowId): RelatedDoc[] => {
      const raw = byId.get(rowId);
      if (raw === undefined) return [];
      const isLinked = raw.strength > 0;
      // `both` is the interesting one: a document that cites this one *and*
      // reads like it is a stronger relation than either alone, and Phase A's
      // hardcoded `linked` could never say so.
      return [
        rowOf(raw, isLinked && similar.has(rowId) ? "both" : isLinked ? "linked" : "similar"),
      ];
    }),
    // Present from Retrieval Phase B onwards, and identical to the word
    // `/api/search` reports for the same workspace: both endpoints degrade
    // together, so both compute it from one service against one predicate.
    semanticIndex: semantic.state,
  };
}

/**
 * The row fields for neighbours the reference graph never produced — the
 * `similar`-only half. One statement over the primary key for the whole page:
 * these documents are already known to exist and to have passed the scan's
 * scope, so nothing here re-filters them.
 */
function loadRelatedRows(db: ProjectionDb, ids: readonly string[]): Map<string, RawRelated> {
  const found = new Map<string, RawRelated>();
  if (ids.length === 0) return found;

  const placeholders = ids.map((_, index) => `@i${String(index)}`).join(", ");
  const params: Record<string, string> = {};
  ids.forEach((id, index) => {
    params[`i${String(index)}`] = id;
  });

  const rows = db
    .prepare(
      `SELECT id, title, body_excerpt AS excerpt, 0 AS strength
         FROM documents WHERE id IN (${placeholders})`,
    )
    .all(params) as RawRelated[];
  for (const row of rows) found.set(row.id, row);
  return found;
}
