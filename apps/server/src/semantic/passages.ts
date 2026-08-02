/**
 * Chunk id → the passage that matched, its address and its document's title.
 *
 * **Extracted, not written** (sprint-022 Open Conflict 2). This is
 * `search/search.ts`'s `loadSemanticOnlyHits` moved here verbatim so the thread
 * context pack (`threads/context.ts`) and ranked search share **one**
 * chunk→row mapping rather than two that drift. The name is kept for the same
 * reason the body is: it names the *reason* a caller needs this lookup — it
 * holds a `chunkId` and no FTS row to take a snippet from — which is true of
 * ranked search's semantic-only hits and of every semantically-promoted excerpt
 * in a pack.
 *
 * The one addition is `maxChars`, defaulted to {@link ONE_LINE_MAX_CHARS} so
 * ranked search's call site and its output are byte-identical to before. The
 * pack's excerpt cap is wider than a search hit's snippet
 * (`CONTEXT_MAX_EXCERPT_CHARS`), and the alternative — returning the raw chunk
 * body and shaping it in two callers — is the second implementation this
 * extraction exists to prevent.
 */

import { ONE_LINE_MAX_CHARS, toOneLine } from "../core/one-line.js";
import type { ProjectionDb } from "../projection/db.js";

/** A document the semantic half found and the lexical half did not. */
export interface SemanticOnlyHit {
  readonly id: string;
  readonly title: string;
  readonly headingPath: string;
  readonly snippet: string;
}

/**
 * Title, address and line of context for the documents only the semantic half
 * found.
 *
 * `chunk_search` holds the chunk's indexable text, which is the passage that
 * matched — so a semantic-only hit's snippet is a taste of the *matching*
 * passage rather than the document's opening line, and its `headingPath` is that
 * chunk's, from the same table the lexical half is addressed through. One
 * statement for the whole page, and only when there is such a hit at all: the
 * common case, where the semantic half re-ranks documents the lexical half also
 * found, reads nothing here.
 */
export function loadSemanticOnlyHits(
  db: ProjectionDb,
  matches: readonly { readonly id: string; readonly chunkId: string }[],
  maxChars: number = ONE_LINE_MAX_CHARS,
): ReadonlyMap<string, SemanticOnlyHit> {
  const hits = new Map<string, SemanticOnlyHit>();
  if (matches.length === 0) return hits;

  const placeholders = matches.map((_, index) => `@c${String(index)}`).join(", ");
  const params: Record<string, string> = {};
  matches.forEach((match, index) => {
    params[`c${String(index)}`] = match.chunkId;
  });

  const rows = db
    .prepare(
      `SELECT s.chunk_id AS chunk_id, s.doc_id AS doc_id, s.heading_path AS heading_path,
              s.body AS body, d.title AS title
         FROM chunk_search s JOIN documents d ON d.id = s.doc_id
        WHERE s.chunk_id IN (${placeholders})
        ORDER BY s.ord`,
    )
    .all(params) as {
    chunk_id: string;
    doc_id: string;
    heading_path: string;
    body: string;
    title: string;
  }[];

  // First `ord` wins, not last. A chunk id can address more than one row —
  // `chunkId` hashes (document, heading path, text), so a document repeating a
  // paragraph verbatim under one heading stores it once and points at it twice —
  // and `new Map(rows.map(…))` would silently keep the *last* position, i.e. the
  // one furthest from the top of the document. The rows arrive `ORDER BY s.ord`,
  // so the first sighting is the earliest occurrence, which is the one a reader
  // sent to that hit expects to land on.
  const byChunk = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byChunk.has(row.chunk_id)) byChunk.set(row.chunk_id, row);
  for (const match of matches) {
    const row = byChunk.get(match.chunkId);
    if (row === undefined) continue;
    hits.set(match.id, {
      id: match.id,
      title: row.title,
      headingPath: row.heading_path,
      snippet: toOneLine(row.body, maxChars),
    });
  }
  return hits;
}

/** The seam a test counts through — the shape {@link loadSemanticOnlyHits} has. */
export type SemanticPassageLoader = typeof loadSemanticOnlyHits;
