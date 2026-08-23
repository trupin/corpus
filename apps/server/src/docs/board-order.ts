import type {
  Actor,
  BoardPosition,
  QueryKey,
  ReorderBoardsResult,
  Warning,
} from "@corpus/contract";
import { BOARD_ORDER_STEP } from "@corpus/contract";
import { serializeDocument, setFrontmatterFields } from "../core/index.js";
import { DOCS_KEY, dedupeKeys, docKey } from "../events/index.js";
import { badRequest } from "../errors.js";
import { loadDocument } from "./read.js";
import {
  applyOperations,
  commitWarnings,
  finishMutation,
  runInLanes,
  validateBeforeWrite,
  type DocsWorkspace,
  type DocumentMutex,
  type FileOperation,
} from "./write.js";

/**
 * `POST /api/boards/order` — the board bar, renumbered in **one** commit
 * (SPEC.md §10, rider 2: "reordering boards writes `order` on every board, in
 * one commit").
 *
 * **Why this is not a loop over `PUT /api/docs/{id}`.** §4's commit window folds
 * a *party's editing session* on a document; it has no fold for an act that
 * spans several. Four `PUT`s are therefore four auto-commits by construction,
 * which makes reverting one reorder four `git revert`s and lets a sequence that
 * fails at the third write leave half an order in the history. This is the same
 * shape the bulk act has, so it takes the same two devices: one
 * `applyOperations` group, so the writes are all-or-nothing on disk, and one
 * `finishMutation` marked `commits-alone`, so the act is its own entry in the
 * history — never folded into a preceding editing session, never joined by a
 * later save.
 *
 * **The positions are derived here, not sent.** The request names the bar in the
 * order it should be in and this assigns `1 … n` over it. A caller cannot spell
 * a contradiction (two boards at 3, a gap, a zero), and every client renumbers
 * identically because only one place does the arithmetic.
 *
 * **A board already at its number is not written.** Every write is an
 * auto-commit that stamps `updated` and lands a line in the log the agent reads,
 * so a bar dragged back where it started writes nothing and commits nothing —
 * and §4's "the commit contains exactly the documents the action changed" stays
 * literally true.
 */
export async function reorderBoards(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  ids: readonly string[],
): Promise<ReorderBoardsResult> {
  // Every named board's lane, for the whole act: the renumbering and the commit
  // are then one critical section, so `boards` and the commit are the same
  // answer rather than two a concurrent save could pull apart. `runInLanes`
  // sorts, so an arbitrary set cannot deadlock against a thread deletion's
  // `[thread, parent]` (SERVER-077).
  return runInLanes(mutex, ids, () => renumber(workspace, actor, ids));
}

/** What one board's renumbering came to, before anything is on disk. */
type PlannedBoard = {
  readonly position: BoardPosition;
  readonly operation: FileOperation | null;
  readonly path: string;
};

async function renumber(
  workspace: DocsWorkspace,
  actor: Actor,
  ids: readonly string[],
): Promise<ReorderBoardsResult> {
  const planned: PlannedBoard[] = ids.map((id, index) => planBoard(workspace, id, index));

  const writes = planned.filter(
    (board): board is PlannedBoard & { operation: FileOperation } => board.operation !== null,
  );
  if (writes.length === 0) {
    // Nothing moved. Not an error, and pointedly not a commit: a commit
    // containing nothing is not one, and `commit: null` is what says so.
    return { boards: planned.map((board) => board.position), commit: null, warnings: [] };
  }

  const warnings: Warning[] = writes.flatMap((board) =>
    validateBeforeWrite(workspace, board.path, contentOf(board.operation)),
  );

  // **One group, not one per board.** `applyOperations` rolls the whole group
  // back if any write in it throws, which is the difference between "the bar is
  // in the order you asked for" and "the first two boards moved". A per-board
  // group would report a partial reorder honestly and still leave one on disk,
  // and no order at all is the better half-way state: the caller retries.
  applyOperations(workspace, writes[0]?.position.id ?? "", [
    ...writes.map((board) => board.operation),
  ]);

  const changedIds = writes.map((board) => board.position.id);
  const commit = await finishMutation(workspace, {
    docId: changedIds[0] ?? "",
    docIds: changedIds,
    actor,
    plan: {
      stage: writes.map((board) => board.path),
      project: writes.map((board) => board.path),
      unproject: [],
      commit: {
        subject: `board reorder: ${countOf(changedIds.length)} by ${actor}`,
        // §4's "two acts commit alone", which a reorder joins for the reason a
        // bulk Save does: it is an act over a set, and an act is not a save. The
        // window closes first and this stands by itself, so `commit` below is
        // the reorder and nothing else.
        act: "commits-alone",
      },
      // Every named board's row moved — or, for the ones already in place, is
      // read by the same lists — so the collection key and each document's own
      // key go. `["tree"]` is deliberately absent: an `order` write moves no
      // file, so `GET /api/tree`'s answer cannot change.
      keys: keysFor(ids),
    },
  });

  return {
    boards: planned.map((board) => board.position),
    // A sha only where one exists: a workspace without git, and a hook that
    // rejected the commit, both leave the renumbered files on disk with nothing
    // to name, and `warnings` is where §11 says so.
    commit:
      commit !== null && (commit.kind === "committed" || commit.kind === "amended")
        ? commit.sha
        : null,
    warnings: [...warnings, ...commitWarnings(commit)],
  };
}

/**
 * One board's position and the write that realizes it, or `null` when the
 * document already carries that number.
 *
 * **Refusals happen here, before any write.** An id naming no document is
 * `loadDocument`'s own `404`; an id naming something that is not a board is a
 * `400`, because rider 2 is explicit that a view document "has no `pinned` and
 * no `order`" — writing a bar position onto one would mean nothing, and a route
 * that let it happen would be the general write path this one exists not to be.
 * Both are the request's fault rather than one document's, so both refuse the
 * whole reorder.
 */
function planBoard(workspace: DocsWorkspace, id: string, index: number): PlannedBoard {
  const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
  if (loaded.row.type !== "board") {
    throw badRequest(
      `${id} is a \`${loaded.row.type}\` document, not a board: \`order\` is a board's position ` +
        "among boards and nothing else (SPEC.md §10), so only `type: board` documents can be " +
        "reordered here.",
      [{ path: `boards[${String(index)}]`, message: `${id} is not a board` }],
    );
  }

  const order = (index + 1) * BOARD_ORDER_STEP;
  const next = serializeDocument(setFrontmatterFields(loaded.parsed, { order }));
  // Compared as **bytes** rather than by reading the current `order`: a file
  // carrying `order: "2"` is at no position the wire can report, and comparing
  // the text is what makes "already there" mean "this write would change
  // nothing".
  const settled = next === loaded.text;
  return {
    position: { id, order, changed: !settled },
    operation: settled ? null : { kind: "write", path: loaded.path, content: next },
    path: loaded.path,
  };
}

const contentOf = (operation: FileOperation): string =>
  operation.kind === "write" ? operation.content : "";

/** The keys one reorder invalidates: the collection, and every board named. */
const keysFor = (ids: readonly string[]): QueryKey[] =>
  dedupeKeys([DOCS_KEY, ...ids.map((id) => docKey(id))]);

/** "1 board" / "4 boards" — a commit subject naming what the act changed (§4). */
const countOf = (total: number): string => `${total} board${total === 1 ? "" : "s"}`;
