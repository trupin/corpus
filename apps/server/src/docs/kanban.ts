// SPEC.md §5's coupling rule (rider signed 2026-08-22; SERVER-138). The rider's
// own words, because everything below is either one of these sentences or a
// decision this module made where the rider is silent:
//
//   **While a document is in a kanban, its stage decides its status**: a stage
//   the board maps to a status writes that status on entry, and a stage with no
//   mapping writes `open`, in the same commit, named in the response. Writing
//   `status` never moves a stage. Whether a document is "in a kanban" is decided
//   by the board's scope query **with archived documents included**, because a
//   document in a stage mapped to `archived` is still in the kanban.
//
// What follows from those sentences, and nothing else does:
//
// - **"In a kanban" is decided by the board's scope query.** Not by a list on
//   the document, not by a folder convention — by the same saved query
//   `GET /api/docs` answers with, which is why {@link matchesQuery} is used and
//   nothing here reimplements the filter grammar.
// - **With archived documents included**, because a document in a stage mapped
//   to `archived` is still in the kanban, and a scope that dropped it would let
//   one archive take a document out of the board that archived it.
// - **Two outcomes, never three.** A stage the board maps writes that status,
//   and every other stage — one the map does not name, one the board does not
//   even draw, and the absence of a stage — is "no mapping" and writes `open`.
//   The rider draws the line at the *map*, so this module does not draw a second
//   one at the `stages` list.
//
// - **The coupling is by an explicit map, never by a stage's name.** A stage
//   called `archived` couples to nothing unless the board's `kanban.status`
//   says so (the user's decision, 2026-08-22, recorded in the Phase 41 plan).
//
// The server enforces the status map and never the transitions. §10's kanban
// rider says it in as many words — "the server does not enforce transitions, it
// enforces the status map" — so a stage write is refused for nothing, and
// skipping the graph is exactly how a person or the CLI moves a document the
// drag cannot.
//
// **Two rules here are this module's, not the spec's**, and are marked as such
// where they are made: an archived board decides nothing, and a document whose
// *root* fixes its status is left alone. Both are SERVER-138's readings of a
// silence, and a citation that lent them §5's authority would be a lie the next
// reader has no way to catch.

import type { DocStatus, ViewQuery, Warning } from "@corpus/contract";
import { DocsQuerySchema, KanbanSchema, type Kanban } from "@corpus/contract";
import { classifyPath, type ProjectionDb } from "../projection/index.js";
import type { FilterQuery } from "./filters.js";
import { matchesQuery } from "./query.js";
import type { StalenessThresholds } from "./staleness.js";
import { valueToWire } from "./selection.js";

/**
 * What a stage with no entry in the board's `status` map writes (SPEC.md §5:
 * "a stage with no mapping writes `open`").
 *
 * "No mapping" covers every stage the map does not name — including one the
 * board does not draw at all, and including no stage. See {@link decideStageStatus}.
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
 * There is always a status: a board that claims the document decides one, and
 * §5's two outcomes cover every stage between them. "No board claimed it" is
 * `decideStageStatus` returning `null` outright, which is the only silence.
 */
export type StageCoupling = {
  readonly board: StageKanbanBoard;
  /** The other kanbans this document is also in, in deciding order after `board`. */
  readonly alsoMatched: readonly StageKanbanBoard[];
  readonly status: DocStatus;
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
 *   is a plain object and strips what it does not declare. A board whose query
 *   names a filter this build has never heard of still has a scope, made of the
 *   keys it does understand. **This is deliberately gentler than
 *   `compileSelectionQuery`**, which refuses an unknown key with a `400`: that query decides what a Save
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
 * The kanbans over `stage`, in deciding order.
 *
 * **The order is SERVER-138's, not the spec's.** §5 says a document's stage
 * decides its status and never says which board decides when two claim the same
 * document, so the issue picked the one a person is looking at first: the lowest
 * `order`. The tiebreak is `GET /api/docs?sort=order`'s, spelled out — `order`
 * with nulls last, then `title`, then `id` — so "the lowest `order`" means the
 * same thing here and in the board bar. A board with no `order` key is placed
 * rather than dropped, exactly as it is there.
 *
 * **Archived boards are excluded, and that is SERVER-138's rule too.** §5 is
 * silent on it. An archived board is out of sight (§5's status ladder), and a
 * board nobody can see deciding a document's status is a change with no visible
 * cause — so a board archived after mapping decides nothing.
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
 * `null` for the stage means the key is being cleared. A cleared stage is in no
 * board's `status` map, so §5's second outcome covers it with no rule of its
 * own: "a stage with no mapping writes `open`".
 */
export function decideStageStatus(
  db: ProjectionDb,
  docId: string,
  relativePath: string,
  stage: string | null,
  nowMs: number,
  // The workspace's staleness ramp (SERVER-133): a board's scope query may name
  // `stale=`, and §9.2 promises it means one thing wherever it is asked.
  thresholds?: StalenessThresholds,
): StageCoupling | null {
  // **SERVER-138's rule, where §5 is silent.** A document whose **root** fixes
  // its status has no status in its frontmatter to decide:
  // `projection/project-document.ts` reads the root first, so an archived skill
  // is `archived` because of the folder it sits in — §7 makes archiving a skill
  // a move to `.claude/skills-archived/` — whatever its `status:` key says.
  // Writing one here would put a value in the file that nothing reads and that
  // `corpus doc check` would then have to explain — and taking such a document
  // off `archived` is `POST /api/docs/{id}/unarchive`'s job, because unarchiving
  // a skill is a filesystem move and a name release rather than a field edit
  // (`assertNotUnarchivingByPut`, `docs/update.ts`).
  //
  // Silent, like the other case that decides nothing: the stage still moves, and
  // it is the board's own column that is drawn from it.
  if (classifyPath(relativePath)?.status != null) return null;

  const matched = stageKanbanBoards(db).filter((board) =>
    matchesQuery(db, boardScopeQuery(board.query), docId, nowMs, thresholds),
  );
  const [board, ...alsoMatched] = matched;
  if (board === undefined) return null;

  // §5's two outcomes, and the `stages` list takes no part in either: the map
  // decides, or nothing does and the answer is `open`. A stage the board does
  // not draw is therefore an ordinary unmapped stage — it shows in no column
  // (UI-152 counts those), and the document it is on is `open`, which is what a
  // document nobody has mapped to a settled stage is.
  const status =
    (stage === null ? undefined : board.kanban.status?.[stage]) ?? UNMAPPED_STAGE_STATUS;

  return { board, alsoMatched, status };
}

/**
 * The coupling "named in the response" (§5) — one warning, naming the stage, the
 * status and the board that decided.
 *
 * **It says which of §5's two outcomes happened**, because they are two
 * different facts for the person reading it: a map entry moved this document, or
 * nothing did and `open` is what an unmapped stage means. A message that claimed
 * the map decided when the map holds no such stage would send somebody looking
 * for an entry that is not there.
 *
 * It names the boards that did **not** decide when there are any, because the
 * deciding order (SERVER-138) is a rule a caller cannot check from a response
 * that mentions one board: two kanbans over one corpus share one `stage` value,
 * so a person whose document jumped to `resolved` needs to know which board's
 * map did it before they can go and change it.
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
          .join(", ")}; the board with the lowest \`order\` decides.`;
  const because =
    stage === null
      ? "and a document in a kanban with no stage has no mapping, so `open` (SPEC.md §5)"
      : coupling.board.kanban.status?.[stage] === undefined
        ? "which maps no status to that stage, and a stage with no mapping is `open` (SPEC.md §5)"
        : "whose `kanban.status` map decides a status on entry (SPEC.md §5)";
  return {
    code: "stage_status",
    detail:
      `stage ${stage === null ? "cleared" : `\`${stage}\``} set status to \`${status}\`: this ` +
      `document is in the kanban ${coupling.board.title} (${coupling.board.id}), ` +
      `${because}.${others}`,
  };
}
