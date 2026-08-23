// SPEC.md §10, rider 2: **at most one board carries `default-open: true`** —
// "setting it on one clears the others, and the response names the documents it
// changed (§9.2)" (SERVER-138).
//
// The rule is a fact about the corpus rather than a gesture on one board, which
// is why it lives in the write path and not in a client. Two boards carrying the
// flag is not a state a person can be shown and asked to fix: whichever one the
// browser happened to pick would be "the default", and the other would look
// identical. So the write that creates the ambiguity is the write that removes
// it, in the same commit, and the response says which documents it touched.

import type { Warning } from "@corpus/contract";
import { serializeDocument, setFrontmatterFields } from "../core/index.js";
import type { ProjectionDb } from "../projection/index.js";
import { loadDocument } from "./read.js";
import type { FileOperation } from "./write.js";

/** The frontmatter key. `defaultOpen` is its wire spelling and never reaches a file. */
export const DEFAULT_OPEN_KEY = "default-open";

/** One board the arbitration took the flag away from. */
export type ClearedBoard = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly content: string;
};

/**
 * Every **other** document whose projection says it carries the flag.
 *
 * Deliberately not restricted to `type: board`. `type` is an open string (§5),
 * the flag means "this is the board that receives every open that names no
 * board", and a document of some other type carrying it is exactly as ambiguous
 * as a second board would be. Restricting the sweep would leave the invariant —
 * *at most one* — false in the one case nobody would think to look at.
 *
 * Archived boards are swept too, for the same reason: an archived board carrying
 * the flag still competes for the browser's first load if it is ever restored,
 * and §10's answer to "which board opens" cannot depend on lifecycle state.
 */
export function boardsCarryingDefaultOpen(
  projection: ProjectionDb,
  exceptId: string,
): { readonly id: string; readonly title: string }[] {
  return projection
    .prepare(
      `SELECT id, title FROM documents
        WHERE json_extract(board_json, '$.defaultOpen') = 1 AND id <> ?
        ORDER BY id ASC`,
    )
    .all(exceptId) as { id: string; title: string }[];
}

/**
 * The writes that clear the flag from every other board, ready to join the
 * plan that sets it.
 *
 * **The key is removed, not written `false`.** Absent and `false` are one state
 * on the wire (`defaultOpen` is a plain boolean, `false` when the file carries
 * no key), so removing it is the clearing — and it leaves a board's frontmatter
 * as it was before anybody ever made it the default, rather than accumulating a
 * `default-open: false` line on every board that ever briefly held the flag.
 *
 * Returns an empty array when nothing carried the flag, which is the normal case
 * and the one that must stay silent (§11: "nothing is said when the act touched
 * nothing outside its request").
 *
 * A board whose row says it carries the flag but whose file no longer does is
 * skipped rather than rewritten: the row is derived, the file is the source of
 * truth, and a no-op write would put an empty commit and a warning in front of a
 * person for a projection that is about to be corrected anyway.
 */
export function planDefaultOpenClears(
  workspaceRoot: string,
  projection: ProjectionDb,
  exceptId: string,
): ClearedBoard[] {
  const cleared: ClearedBoard[] = [];
  for (const board of boardsCarryingDefaultOpen(projection, exceptId)) {
    const loaded = loadDocument(workspaceRoot, projection, board.id);
    if (!Object.hasOwn(loaded.parsed.data, DEFAULT_OPEN_KEY)) continue;
    const next = serializeDocument(
      setFrontmatterFields(loaded.parsed, { [DEFAULT_OPEN_KEY]: undefined }),
    );
    if (next === loaded.text) continue;
    cleared.push({ id: board.id, title: board.title, path: loaded.path, content: next });
  }
  return cleared;
}

/** The file writes for a set of clears, in the shape a `MutationPlan` takes them. */
export const clearOperations = (cleared: readonly ClearedBoard[]): FileOperation[] =>
  cleared.map((board) => ({ kind: "write", path: board.path, content: board.content }));

/**
 * §11's report of the clears — one warning per board, naming it.
 *
 * One per board rather than one listing them all: `detail` is prose a client
 * renders verbatim and never parses, and a console showing three lines is what
 * lets a person see three documents changed.
 */
export const clearWarnings = (cleared: readonly ClearedBoard[]): Warning[] =>
  cleared.map((board) => ({
    code: "default_open_cleared" as const,
    detail:
      `${board.title} (${board.id}) is no longer the default-open board: at most one board ` +
      "carries `default-open` (SPEC.md §10), and this write took it.",
  }));
