// SPEC.md §5's coupling rule: **while a document is in a kanban, its stage
// decides its status** (rider 5, signed 2026-08-22; SERVER-138).
//
// Three sentences of the rider are the whole of this module, and each one is a
// decision somebody could have taken differently:
//
// - **"In a kanban" is decided by the board's scope query.** Not by a list on
//   the document, not by a folder convention — by the same saved query
//   `GET /api/docs` answers with, which is why {@link matchesQuery} is used and
//   nothing here reimplements the filter grammar.
// - **With archived documents included**, because a document in a stage mapped
//   to `archived` is still in the kanban, and a scope that dropped it would let
//   one archive take a document out of the board that archived it.
// - **The coupling is by an explicit map, never by a stage's name.** A stage
//   called `archived` couples to nothing unless the board's `kanban.status`
//   says so (the user's decision, 2026-08-22, recorded in the Phase 41 plan).
//
// The server enforces the status map and never the transitions (§10, rider 6):
// a stage write is refused for nothing, and skipping the graph is exactly how a
// person or the CLI moves a document the drag cannot.

import type { DocStatus, ViewQuery, Warning } from "@corpus/contract";
import { DocsQuerySchema, KanbanSchema, type Kanban } from "@corpus/contract";
import { classifyPath, type ProjectionDb } from "../projection/index.js";
import type { FilterQuery } from "./filters.js";
import { matchesQuery } from "./query.js";
import { valueToWire } from "./selection.js";

/**
 * What a stage with no entry in the board's `status` map writes (SPEC.md §5:
 * "a stage with no mapping writes `open`").
 */
export const UNMAPPED_STAGE_STATUS: DocStatus = "open";

/** One board that draws a kanban over `stage`, as the deciding order sees it. */
export type StageKanbanBoard = {
  readonly id: string;
  readonly title: string;
  readonly query: ViewQuery | null;
  readonly kanban: Kanban;
};

/**
 * What the coupling decided for one write.
 *
 * `status` is `null` for the case §5 leaves alone — "a document whose `stage` is
 * not in any matching board's `stages`: no status write, and no warning" — which
 * is not the same as "no board matched" (`decideStageStatus` returns `null`
 * outright for that). Both are silent; only this one had a board to be silent
 * about, and the distinction is what keeps a stage the board has never heard of
 * from being read as the unmapped case and forced to `open`.
 */
export type StageCoupling = {
  readonly board: StageKanbanBoard;
  /** The other kanbans this document is also in, in deciding order after `board`. */
  readonly alsoMatched: readonly StageKanbanBoard[];
  readonly status: DocStatus | null;
};

/**
 * A board's scope query as the collection query's own filter set.
 *
 * The stored `query` is a flat map from `GET /api/docs` parameter names to a
 * value or an array of values, and an array ORs exactly like the comma-separated
 * wire form. So the compilation is: spell every value the way the wire spells
 * it, then hand the result to `DocsQuerySchema` — the same parser the HTTP
 * endpoint runs. Two things follow for free, and both are the reason it is done
 * this way rather than by reading keys off the object:
 *
 * - **A key the query grammar does not define is dropped**, because the schema
 *   is a plain object and strips what it does not declare. §10 promises exactly
 *   that ("an unknown key degrades in the client, never on the wire"), and this
 *   is the server side of the same promise: a board whose query names a filter
 *   this build has never heard of still has a scope, made of the keys it does
 *   understand. **This is deliberately gentler than `compileSelectionQuery`**,
 *   which refuses an unknown key with a `400`: that query decides what a Save
 *   *writes*, and it is the caller's own, so it must be told. This one decides
 *   whether a stage write couples, and it belongs to a **third** document the
 *   caller never named — refusing here would make an unrelated board's typo
 *   break every stage write in the corpus.
 * - **A malformed value is dropped with its key** rather than making the whole
 *   scope unusable — `DocsQuerySchema` refuses the parse, and the fallback is
 *   the empty filter set, which is every non-archived document. That is the
 *   widest scope, and it is deliberately not the narrowest: a board whose query
 *   somebody broke should couple too much and be visibly wrong, rather than
 *   couple nothing and be invisibly wrong.
 *
 * `includeArchived` is forced on, per §5. A `status` the board's own query names
 * still narrows — `includeArchived` is documented as a no-op beside an explicit
 * `status` — and that is the board author's choice rather than something to
 * override here.
 */
export function boardScopeQuery(query: ViewQuery | null): FilterQuery {
  const raw: Record<string, string> = {};
  // The same translation a bulk Save makes of the same stored shape
  // (`docs/selection.ts`), so a board's scope and a column's staged set cannot
  // spell one query two ways.
  for (const [key, value] of Object.entries(query ?? {})) raw[key] = valueToWire(value);
  raw["includeArchived"] = "true";
  const parsed = DocsQuerySchema.safeParse(raw);
  if (!parsed.success) return { includeArchived: true };
  const { sort: _sort, limit: _limit, offset: _offset, ...filters } = parsed.data;
  return filters;
}

/**
 * The kanbans over `stage`, in the order §5 makes them decide: "the one with the
 * lowest `order` decides".
 *
 * The tiebreak is `GET /api/docs?sort=order`'s, spelled out — `order` with nulls
 * last, then `title`, then `id` — so "the lowest `order`" means the same thing
 * here and in the board bar a person is looking at. A board with no `order` key
 * is placed rather than dropped, exactly as it is there.
 *
 * Archived boards are excluded: §5's edge case says a board archived after
 * mapping "no longer decides anything".
 */
export function stageKanbanBoards(db: ProjectionDb): StageKanbanBoard[] {
  const rows = db
    .prepare(
      `SELECT id, title, query_json, board_json
         FROM documents
        WHERE type = 'board' AND status <> 'archived' AND board_json IS NOT NULL
        ORDER BY sort_order IS NULL, sort_order ASC, title COLLATE NOCASE ASC, id ASC`,
    )
    .all() as { id: string; title: string; query_json: string | null; board_json: string }[];

  const boards: StageKanbanBoard[] = [];
  for (const row of rows) {
    let stored: unknown;
    try {
      stored = JSON.parse(row.board_json);
    } catch {
      continue;
    }
    if (typeof stored !== "object" || stored === null) continue;
    const kanban = KanbanSchema.safeParse((stored as Record<string, unknown>)["kanban"]);
    if (!kanban.success || kanban.data.field !== "stage") continue;
    boards.push({
      id: row.id,
      title: row.title,
      query: row.query_json === null ? null : (JSON.parse(row.query_json) as ViewQuery),
      kanban: kanban.data,
    });
  }
  return boards;
}

/**
 * The status a document's stage decides, or `null` when no kanban claims it.
 *
 * `stage` is the value the write is **about to leave on disk**, and the caller is
 * expected to have made the projection say so too — see
 * `withSpeculativeDocumentRow`. Asking against the stored row would decide a
 * create's membership from a row that does not exist yet, and a save's from the
 * stage the document is leaving.
 *
 * `null` for the stage means the key is being cleared, and §5's edge case makes
 * that the **unmapped** case rather than a stage of its own: "`stage: null`
 * (clearing) on a document in a kanban writes `open`".
 */
export function decideStageStatus(
  db: ProjectionDb,
  docId: string,
  relativePath: string,
  stage: string | null,
  nowMs: number,
): StageCoupling | null {
  // A document whose **root** fixes its status has no status in its frontmatter
  // to decide: `projection/project-document.ts` reads the root first, so §7's
  // skills are `archived` because of the folder they sit in, whatever the key
  // says. Writing one here would put a value in the file that nothing reads and
  // that `corpus doc check` would then have to explain — and taking such a
  // document off `archived` is `POST /api/docs/{id}/unarchive`'s job, because
  // unarchiving a skill is a filesystem move and a name release rather than a
  // field edit (`assertNotUnarchivingByPut`, `docs/update.ts`).
  //
  // Silent, like the two other cases that decide nothing: the stage still moves,
  // and it is the board's own column that is drawn from it.
  if (classifyPath(relativePath)?.status != null) return null;

  const matched = stageKanbanBoards(db).filter((board) =>
    matchesQuery(db, boardScopeQuery(board.query), docId, nowMs),
  );
  const [board, ...alsoMatched] = matched;
  if (board === undefined) return null;

  // A stage the deciding board does not draw is not part of a kanban's
  // vocabulary yet (§5's edge case): the document is in the kanban, the stage is
  // not, and writing `open` for it would silently reopen work over a typo.
  // Clearing the stage is the one absent value that *is* the unmapped case.
  const status =
    stage === null
      ? UNMAPPED_STAGE_STATUS
      : board.kanban.stages.includes(stage)
        ? (board.kanban.status?.[stage] ?? UNMAPPED_STAGE_STATUS)
        : null;

  return { board, alsoMatched, status };
}

/**
 * §11's report of the coupling — one warning, naming the stage, the status and
 * the board that decided.
 *
 * It names the boards that did **not** decide when there are any, because §5's
 * "the one with the lowest `order` decides" is a rule a caller cannot check from
 * a response that mentions one board: two kanbans over one corpus share one
 * `stage` value, so a person whose document jumped to `resolved` needs to know
 * which board's map did it before they can go and change it.
 */
export function stageStatusWarning(
  coupling: StageCoupling,
  stage: string | null,
  status: DocStatus,
): Warning {
  const others =
    coupling.alsoMatched.length === 0
      ? ""
      : ` It also matches ${coupling.alsoMatched
          .map((board) => `${board.title} (${board.id})`)
          .join(", ")}; the board with the lowest \`order\` decides (SPEC.md §5).`;
  return {
    code: "stage_status",
    detail:
      `stage ${stage === null ? "cleared" : `\`${stage}\``} set status to \`${status}\`: this ` +
      `document is in the kanban ${coupling.board.title} (${coupling.board.id}), whose ` +
      `\`kanban.status\` map decides a status on entry (SPEC.md §5).${others}`,
  };
}
