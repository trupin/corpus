// `GET /api/threads/{id}/context` — the thread's **context pack** (SPEC.md §7
// Retrieval discipline, §9.2; Retrieval Phase C).
//
// **A briefing, never a dump.** §7's signed sentence — "reading it costs roughly
// the same however large the corpus grows" — is the whole design, and it is what
// makes this a bounded *assembly* rather than a join: two halves, each capped by
// a constant the contract publishes, and every statement below bounded by the
// answered page rather than by the corpus.
//
// **Two halves.**
//
// - The **parent side** is the passage the conversation is about, and it comes
//   from `core/headings.ts` — never from the chunk tables. A section larger than
//   `CHUNK_CHAR_BUDGET` is *split* into several chunks (`semantic/chunker.ts`),
//   so a chunk is a fragment of a section by construction and assembling "the
//   whole enclosing section" out of chunks cannot satisfy its own name
//   (sprint-022 C2). `headingSections(body)` answers it in one fence-aware scan,
//   from the same source the chunker and the search address use, so the three
//   can never disagree about what a heading is.
// - The **related side** is the same two graphs `GET /api/docs/{id}/related`
//   fuses — the `links` table and the semantic index — through the *same*
//   primitives (`fuseRankings`, `overFetchLimit`, `notArchivedSql`). No new RRF,
//   no new overfetch factor, no score blend. What differs is the row: §7 and
//   §9.2 both say "each an id + heading path + short excerpt", and `RelatedDoc`
//   has no heading path and deliberately excerpts a document's *opening* line
//   rather than the passage that matched (sprint-022 C4 / Open Conflict 2).
//
// **Five shapes, one discriminated field** (Open Conflict 9, sprint-022 C1). A
// thread is anchored to a passage, to a whole document, to nothing, to a passage
// that no longer resolves, or to a document that has since been deleted. The
// last one is the one worth naming here: `DELETE /api/docs/{id}` leaves threads
// as orphaned records naming a document that is gone (SPEC.md §9.2), so the
// naive implementation propagates the parent's 404 and answers "no such thread"
// about a thread that plainly exists. This module answers **200** with the
// standalone shape plus the id that no longer resolves — the case where a
// briefing is hardest to reconstruct by hand is exactly the case that must not
// fail.
//
// **Rank first, cut second** (Open Conflict 4). The caps are enforced here —
// nothing in the shipped stack validates a response — and the order matters:
// cutting first and ranking the remainder returns the excerpts the scan happened
// to read rather than the ones that matter.
//
// Reads five tables, writes nothing, commits nothing and
// invalidates nothing: a pure projection-plus-file read, like `related` and
// `search`.

import {
  CONTEXT_MAX_EXCERPT_CHARS,
  CONTEXT_MAX_EXCERPTS,
  CONTEXT_MAX_QUOTE_CHARS,
  CONTEXT_MAX_SECTION_CHARS,
  type ContextExcerpt,
  type ContextPack,
  type Relation,
  type SemanticIndexState,
} from "@corpus/contract";
import { headingSections, type HeadingSection } from "../core/headings.js";
import { toOneLine } from "../core/one-line.js";
import {
  findDocumentRow,
  loadDocument,
  notArchivedSql,
  readAnchorsMap,
  type LoadedDocument,
} from "../docs/index.js";
import { HttpError } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import { fuseRankings, overFetchLimit } from "../search/index.js";
import {
  CHUNK_CHAR_BUDGET,
  loadSemanticOnlyHits,
  renderHeadingPath,
  type SemanticOutcome,
  type SemanticPassageLoader,
  type SemanticRetrieval,
  type SemanticScope,
} from "../semantic/index.js";
import { loadThread, type LoadedThread, type ThreadReader } from "./read.js";

export interface ContextDeps {
  /**
   * Retrieval's semantic half. Absent, the related excerpts are the reference
   * graph alone and the state word is `disabled` — the same honest answer
   * `related.ts` and `search.ts` give a server with no semantic index wired,
   * which is what a fresh workspace and a unit test both have.
   */
  readonly semantic?: SemanticRetrieval | undefined;
  /**
   * Injectable so a test can count what a request actually read — the seam
   * `search.ts`'s `loadAddresses` has held since SERVER-042, and the one
   * TEST-972 counts through to prove the pack's cost does not grow with the
   * corpus.
   */
  readonly loadPassages?: SemanticPassageLoader | undefined;
}

const DISABLED: SemanticOutcome = { state: "disabled", docs: [] };

/**
 * Neighbours of a *conversation*, which is one or two seeds rather than one
 * document (Open Conflict 2): the union of the thread's own `links` rows and its
 * parent's.
 *
 * Both, because both are true of the same conversation. For an anchored thread
 * the parent's reference graph is the useful one — it is what the passage cites
 * and what cites it — while a `[[ref]]` typed into a turn is already a row keyed
 * on the *thread's* id (`docs/related.ts`), so dropping either half would hide
 * exactly one of the two ways a document can bear on this discussion.
 *
 * Otherwise this is `RELATED_SQL` with a seed *set*: same fold over the two
 * directions, same mutual-first ranking, same tie-break by recency then id, same
 * INNER join that drops a dangling reference rather than handing back an
 * unreadable id.
 */
const LINKED_SQL = (seeds: string, where: string): string => `WITH edges AS (
    SELECT to_id AS id, 1 AS outgoing, 0 AS incoming FROM links WHERE from_id IN (${seeds})
    UNION ALL
    SELECT from_id AS id, 0 AS outgoing, 1 AS incoming FROM links WHERE to_id IN (${seeds})
  ),
  n AS (
    SELECT id, MAX(outgoing) AS outgoing, MAX(incoming) AS incoming
      FROM edges WHERE id NOT IN (${seeds}) GROUP BY id
  )
SELECT d.id AS id, d.title AS title, d.body_excerpt AS excerpt
  FROM n JOIN documents d ON d.id = n.id
  ${where}
  ORDER BY (n.outgoing + n.incoming) DESC, d.updated IS NULL, d.updated DESC, d.id ASC
  LIMIT @limit`;

interface RawNeighbour {
  readonly id: string;
  readonly title: string;
  readonly excerpt: string;
}

/**
 * The pack for the thread `id` names, or the contract's 404 when it names
 * nothing — or names a document that is not a thread, which is a 404 on *this*
 * surface for the reason `GET /api/threads/{id}` gives: the question is about a
 * thread, and there is no thread with that id.
 */
export async function threadContextPack(
  workspace: ThreadReader,
  id: string,
  deps: ContextDeps = {},
): Promise<ContextPack> {
  const thread = loadThread(workspace, id);
  const db = workspace.projection;
  const parent = thread.parent === null ? null : readableParent(workspace, thread.parent);

  // The parent side first, because the anchor's own quote is part of the
  // *ranking* input: SPEC.md §7 says the excerpts are ranked "by relatedness to
  // the thread's anchor and text", and the anchor's text is the most specific
  // thing about the conversation there is.
  const side = parent === null ? null : parentSide(db, thread, parent);
  const seeds = parent === null ? [thread.id] : [thread.id, parent.row.id];
  const related = await relatedExcerpts(db, deps, seeds, rankingText(thread, side?.quote));
  const base = { threadId: thread.id, excerpts: related.excerpts, semanticIndex: related.state };

  if (thread.parent !== null && parent === null) {
    return { shape: "parent-deleted", ...base, deletedParent: thread.parent };
  }
  if (side === null) return { shape: "standalone", ...base };
  return { ...side.pack, ...base };
}

/**
 * The parent as this request can actually read it, or `null` — which is Open
 * Conflict 9's `parent-deleted`.
 *
 * Two ways a parent stops being readable and one answer, because the thread does
 * not care which: `DELETE /api/docs/{id}` removed the row, or the row survives a
 * file that vanished under it. Both are "the document this conversation was
 * about is gone", and neither may become a 404 about a thread that exists. An
 * *unparseable* parent is deliberately not caught: that is a 500 either way, and
 * silently reporting it as deleted would hide a workspace someone must repair.
 */
function readableParent(workspace: ThreadReader, parentId: string): LoadedDocument | null {
  if (findDocumentRow(workspace.projection, parentId) === null) return null;
  try {
    return loadDocument(workspace.workspaceRoot, workspace.projection, parentId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

/** The parent-side half of a pack, plus the quote the ranking also wants. */
interface ParentSide {
  readonly pack:
    | Pick<Extract<ContextPack, { shape: "anchored" }>, "shape" | "parent">
    | Pick<Extract<ContextPack, { shape: "whole-document" }>, "shape" | "parent">
    | Pick<Extract<ContextPack, { shape: "orphaned-anchor" }>, "shape" | "parent">;
  /** The anchor's text, when there is an anchor at all — anchored or orphaned. */
  readonly quote: string | undefined;
}

/**
 * Which of the three parent-bearing shapes this thread has, and its parent
 * block.
 *
 * The anchored/orphaned split is decided by `anchors.resolved_offset`, and by
 * nothing else. That column is populated by `projection/project-document.ts`
 * with the same full §6 ladder `docs/read.ts` runs (SERVER-055), so `NULL` *is*
 * §6's orphan state, already computed, and the agent is never told a thread is
 * detached while the board draws a highlight for it. A pack that re-ran the
 * ladder itself would be a second implementation of the same question — one
 * definition of "resolves", in the projector.
 */
function parentSide(db: ProjectionDb, thread: LoadedThread, parent: LoadedDocument): ParentSide {
  const title = parent.row.title;
  const identity = { id: parent.row.id, title };
  if (thread.anchor === null) {
    const body = parent.parsed.body;
    const opening = clipLines(openingText(body), CONTEXT_MAX_SECTION_CHARS);
    return {
      pack: {
        shape: "whole-document",
        parent: { ...identity, opening: opening.text, truncated: opening.truncated },
      },
      quote: undefined,
    };
  }

  const anchor = readAnchor(db, thread.anchor, parent);
  const quote = anchor.exact.slice(0, CONTEXT_MAX_QUOTE_CHARS);
  const cutQuote = quote.length < anchor.exact.length;

  if (anchor.offset === null) {
    return {
      pack: {
        shape: "orphaned-anchor",
        parent: { ...identity, quote, truncated: cutQuote },
      },
      quote: anchor.exact,
    };
  }

  const body = parent.parsed.body;
  const section = sectionAt(headingSections(body), anchor.offset);
  const whole = body.slice(section.start, section.end);
  const cut = clipAroundAnchor(
    whole,
    anchor.offset - section.start,
    anchor.exact.length,
    CONTEXT_MAX_SECTION_CHARS,
  );
  return {
    pack: {
      shape: "anchored",
      parent: {
        ...identity,
        headingPath: renderHeadingPath(section.headings, title),
        quote,
        section: cut.text,
        truncated: cut.truncated || cutQuote,
      },
    },
    quote: anchor.exact,
  };
}

/** The anchor's preserved text, and where it resolves — `null` when it does not. */
interface ResolvedAnchor {
  readonly exact: string;
  readonly offset: number | null;
}

/**
 * The anchor, read the way the rest of the server reads a document: **the quote
 * from the file, the offset from the projection**.
 *
 * The file is the source of truth for the selector (§5), and the projection is
 * the only place the exact-only resolution lives — recomputing it here would be
 * a second resolver. The two are cross-checked before the offset is trusted: a
 * projection that has not caught up with a save addresses the old body, and
 * reporting the wrong section as "the passage this conversation is about" is
 * worse than reporting the anchor as orphaned for the fraction of a second it
 * takes the watcher to heal. The check is a slice comparison, never a search.
 *
 * A thread naming an anchor the parent's frontmatter no longer carries is
 * orphaned with whatever quote survives — the projection row if it is still
 * there, the empty string if nothing is. §6 keeps the quote; it cannot invent
 * one.
 */
function readAnchor(db: ProjectionDb, anchorId: string, parent: LoadedDocument): ResolvedAnchor {
  const row = db
    .prepare(
      "SELECT exact_text, resolved_offset FROM anchors WHERE doc_id = @doc AND anchor_id = @anchor",
    )
    .get({ doc: parent.row.id, anchor: anchorId }) as
    { exact_text: string; resolved_offset: number | null } | undefined;

  const selector = readAnchorsMap(parent.parsed.data["anchors"])[anchorId];
  const exact = selector?.exact ?? row?.exact_text ?? "";
  const offset = row?.resolved_offset ?? null;
  if (offset === null || exact === "") return { exact, offset: null };
  const resolves = parent.parsed.body.slice(offset, offset + exact.length) === exact;
  return { exact, offset: resolves ? offset : null };
}

/**
 * The section enclosing `offset`.
 *
 * `headingSections` returns a partition covering the body exactly, so exactly
 * one section contains any offset inside it; an offset at (or past) the very end
 * belongs to the last one, which is the same fallback `enclosingHeadings` makes.
 */
function sectionAt(sections: readonly HeadingSection[], offset: number): HeadingSection {
  const found = sections.find((section) => offset >= section.start && offset < section.end);
  return found ?? sections[sections.length - 1] ?? { headings: [], start: 0, end: 0 };
}

/**
 * A document's **opening content** (SPEC.md §7): the preamble above the first
 * heading, or the first heading section when there is no preamble.
 *
 * Not `body_excerpt` — that is 280 raw characters cut mid-word, which sizes a
 * list row's preview — and not the body.
 */
function openingText(body: string): string {
  const sections = headingSections(body);
  const preamble = sections[0];
  if (preamble !== undefined && body.slice(preamble.start, preamble.end).trim() !== "") {
    return body.slice(preamble.start, preamble.end);
  }
  const first = sections[1] ?? preamble;
  return first === undefined ? "" : body.slice(first.start, first.end);
}

/** Text bounded to a cap, and whether the cap cut it. */
interface Clipped {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Bounds prose that has no anchor to centre on, at a line boundary when there is
 * one inside the cap.
 *
 * The contract asks the opening for "whole units of prose, never a character
 * slice of the body", and a cut at the last newline is the cheapest honest
 * approximation — a half sentence is a worse briefing than a whole paragraph,
 * and the `truncated` flag says the rest exists either way.
 */
function clipLines(text: string, cap: number): Clipped {
  if (text.length <= cap) return { text, truncated: false };
  const window = text.slice(0, cap);
  const lastBreak = window.lastIndexOf("\n");
  return { text: lastBreak > 0 ? window.slice(0, lastBreak) : window, truncated: true };
}

/**
 * Bounds a section **around the anchor** (Open Conflict 1).
 *
 * "The whole enclosing section" and "bounded" are in genuine tension — a single
 * heading section can be tens of kilobytes — and the bound wins *visibly*: the
 * quote and its immediate surroundings always survive, and `truncated` says the
 * agent must escalate to `GET /api/docs/{id}` rather than edit against text it
 * believes is complete. The remaining budget is split evenly before and after
 * the quote; a quote longer than the whole cap keeps its beginning, because a
 * window that started in the middle of the selection would address a passage
 * nobody selected.
 *
 * No ellipsis marker: it would spend the caller's cap on punctuation, and the
 * flag is the claim.
 */
function clipAroundAnchor(
  section: string,
  anchorStart: number,
  anchorLength: number,
  cap: number,
): Clipped {
  if (section.length <= cap) return { text: section, truncated: false };
  const margin = Math.floor(Math.max(0, cap - anchorLength) / 2);
  const start = Math.min(Math.max(0, anchorStart - margin), section.length - cap);
  return { text: section.slice(start, start + cap), truncated: true };
}

/**
 * What the related half is ranked against: **the anchor and the thread's text**
 * (SPEC.md §7), in that order.
 *
 * The anchor first because it is the most specific statement of the subject; the
 * title and the turns after it because a conversation routinely moves past the
 * passage it started on, and a document that bears on what the turns are now
 * discussing is exactly what the pack is for.
 *
 * Bounded by `CHUNK_CHAR_BUDGET` — the corpus's own answer to "how much text is
 * one embedding unit" — so a hundred-turn thread does not send a hundred turns
 * to a provider. The turn *headings* are left out: `## agent · <ts>` is metadata
 * the ranking cannot use and the token budget would pay for.
 */
function rankingText(thread: LoadedThread, quote: string | undefined): string {
  const parts = [quote ?? "", thread.title, ...thread.turns.map((turn) => turn.body)];
  return parts
    .filter((part) => part.trim() !== "")
    .join("\n\n")
    .slice(0, CHUNK_CHAR_BUDGET);
}

/** The related half, and the one honest word about how it was ranked. */
interface RelatedHalf {
  readonly excerpts: ContextExcerpt[];
  readonly state: SemanticIndexState;
}

/**
 * The excerpts, ranked then cut.
 *
 * Both halves over-fetch to `overFetchLimit(CONTEXT_MAX_EXCERPTS)` — fusion that
 * saw only the top ten of each list could never learn that the document ranked
 * eleventh in the graph is first semantically — and `fuseRankings` does the
 * cutting, after the ranking, at the contract's cap.
 *
 * §11's archived default reaches both graphs through **one** fragment:
 * `notArchivedSql("d")` is the links statement's WHERE and the semantic scan's
 * scope, the shape `related.ts` established. The seeds — the thread and, when
 * there is one, its parent — are excluded in the same fragment on both sides,
 * because the pack is context *around* the conversation and both are already in
 * it.
 */
async function relatedExcerpts(
  db: ProjectionDb,
  deps: ContextDeps,
  seeds: readonly string[],
  text: string,
): Promise<RelatedHalf> {
  const loadPassages = deps.loadPassages ?? loadSemanticOnlyHits;
  const placeholders = seeds.map((_, index) => `@x${String(index)}`).join(", ");
  const params: Record<string, unknown> = {};
  seeds.forEach((seed, index) => {
    params[`x${String(index)}`] = seed;
  });

  const fetchLimit = overFetchLimit(CONTEXT_MAX_EXCERPTS);
  const scope: SemanticScope = {
    where: `${notArchivedSql("d")} AND d.id NOT IN (${placeholders})`,
    params,
  };
  // A query with nothing to embed is not a question the index can answer, and
  // sending it would return the corpus in an arbitrary order. The state word is
  // still owed, so it comes from the service rather than being assumed.
  const semantic =
    deps.semantic === undefined
      ? DISABLED
      : text.trim() === ""
        ? { state: await deps.semantic.state(), docs: [] }
        : await deps.semantic.forQuery(text, scope, fetchLimit);

  const linked = db
    .prepare(LINKED_SQL(placeholders, `WHERE ${notArchivedSql("d")}`))
    .all({ ...params, limit: fetchLimit }) as RawNeighbour[];

  // One list means the list itself: RRF over a single ranking re-derives its own
  // order, so a workspace with no semantic index answers the reference graph
  // exactly as it stands.
  const ranked =
    semantic.docs.length === 0
      ? linked.slice(0, CONTEXT_MAX_EXCERPTS).map((row) => row.id)
      : fuseRankings(
          [linked.map((row) => row.id), semantic.docs.map((match) => match.id)],
          CONTEXT_MAX_EXCERPTS,
        ).map((entry) => entry.id);

  const promoted = new Set(ranked);
  const similar = new Set(semantic.docs.map((match) => match.id));
  const passages = loadPassages(
    db,
    semantic.docs.filter((match) => promoted.has(match.id)),
    CONTEXT_MAX_EXCERPT_CHARS,
  );

  const byId = new Map(linked.map((row) => [row.id, row]));
  // Captured before the fill below: `byId` is about to gain rows the reference
  // graph never produced, and `linked` is what makes a row `linked` or `both`.
  const linkedIds = new Set(byId.keys());
  const missing = ranked.filter((rowId) => !byId.has(rowId) && !passages.has(rowId));
  for (const [rowId, row] of loadNeighbourRows(db, missing)) byId.set(rowId, row);

  return {
    excerpts: ranked.flatMap((rowId): ContextExcerpt[] => {
      const isLinked = linkedIds.has(rowId);
      const relation: Relation =
        isLinked && similar.has(rowId) ? "both" : isLinked ? "linked" : "similar";
      const passage = passages.get(rowId);
      if (passage !== undefined) {
        return [
          {
            id: rowId,
            headingPath: passage.headingPath,
            excerpt: passage.snippet,
            relation,
          },
        ];
      }
      const row = byId.get(rowId);
      if (row === undefined) return [];
      // §9.2's address floor. A document the reference graph alone produced has
      // no *matching* passage to name — nothing was matched, it was cited — so
      // its address is the document's title, the same fallback a search hit with
      // no heading above it reports, and its excerpt is the stored opening line
      // rather than a disk read the pack's frugality contract does not allow.
      return [
        {
          id: rowId,
          headingPath: row.title,
          excerpt: toOneLine(row.excerpt, CONTEXT_MAX_EXCERPT_CHARS),
          relation,
        },
      ];
    }),
    state: semantic.state,
  };
}

/**
 * Title and stored excerpt for neighbours neither the links statement nor the
 * chunk lookup produced — a semantically promoted document whose matching chunk
 * has no `chunk_search` row (an index mid-rebuild). One statement over the
 * primary key for the whole page; these documents already passed the scan's
 * scope, so nothing here re-filters them.
 */
function loadNeighbourRows(db: ProjectionDb, ids: readonly string[]): Map<string, RawNeighbour> {
  const found = new Map<string, RawNeighbour>();
  if (ids.length === 0) return found;

  const placeholders = ids.map((_, index) => `@i${String(index)}`).join(", ");
  const params: Record<string, string> = {};
  ids.forEach((id, index) => {
    params[`i${String(index)}`] = id;
  });

  const rows = db
    .prepare(
      `SELECT id, title, body_excerpt AS excerpt
         FROM documents WHERE id IN (${placeholders})`,
    )
    .all(params) as RawNeighbour[];
  for (const row of rows) found.set(row.id, row);
  return found;
}
