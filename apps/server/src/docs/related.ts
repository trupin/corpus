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
// Reads two tables, writes nothing, takes no lock: a pure projection read like
// the collection query it sits beside.

import type { RelatedDoc, RelatedDocs, RelatedQuery } from "@corpus/contract";
import { toOneLine } from "../core/one-line.js";
import { notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
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

/**
 * The documents `id` is connected to, ranked. Throws the contract's 404 when
 * `id` names no document — the same shape `GET /api/docs/{id}` produces, since
 * the question is about a document that does not exist either way.
 */
export function relatedDocs(db: ProjectionDb, id: string, query: RelatedQuery): RelatedDocs {
  if (findDocumentRow(db, id) === null) throw notFound(`no document with id ${id}`);

  // §11's archived default, through the *same* fragment the collection query
  // and the unread aggregate use: archiving is organizational, so an archived
  // neighbour is a real relation that is simply not what an agent expanding
  // from a live document usually wants first.
  const sql = RELATED_SQL(query.includeArchived === true ? "" : `WHERE ${notArchivedSql("d")}`);
  const rows = db.prepare(sql).all({ id, limit: query.limit }) as RawRelated[];

  // `semanticIndex` is absent in Phase A for the same reason it is absent from
  // a search response: there is no semantic index, so the server makes no claim
  // about one (SPEC.md §9.1 — Retrieval Phase B's seam).
  return {
    related: rows.map((row): RelatedDoc => ({
      id: row.id,
      title: row.title,
      // The projection's stored `body_excerpt` is 280 characters from the
      // first non-blank one — a multi-line slice, which is what a *list row*
      // wants. Retrieval's row is printed one per line, so it is collapsed and
      // bounded here rather than re-derived from the file: no disk read, and
      // the same one-line rule a search hit's snippet obeys.
      excerpt: toOneLine(row.excerpt),
      // Phase A relates through the reference graph and nothing else. The
      // enum carries `similar` and `both` so Phase B adds semantic neighbours
      // without moving the shape; emitting either today would be Phase B
      // leaking early.
      relation: "linked",
    })),
  };
}
