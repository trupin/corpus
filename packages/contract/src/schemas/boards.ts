import { z } from "zod";
import { DocumentIdSchema } from "./id.js";
import { warningsField } from "./warning.js";
import { openapi } from "./openapi-metadata.js";

/**
 * **Reordering the board bar** (SPEC.md §10, rider 2 signed 2026-08-22):
 * "reordering boards writes `order` on every board, **in one commit**".
 *
 * ## Why a route of its own, rather than a `PUT` per board
 *
 * `order` is a board's position among boards and nothing else (§10, rider 7), so
 * a reorder is a statement about the **set**: it renumbers the bar rather than
 * nudging one member. Writing it one document at a time cannot say that. §4's
 * commit window folds a *party's editing session* on a document, never a
 * multi-document act, so `PUT /api/docs/{id}` × 4 is four auto-commits by
 * construction — reverting "the reorder" is then four `git revert`s, and a
 * sequence that fails after the second write leaves half an order in the
 * history. That is exactly the fragmentation §4's "One action, one commit" was
 * written to replace: "archiving twenty documents is one commit, not twenty".
 *
 * ## Why not an act on `POST /api/docs/bulk`
 *
 * Weighed and rejected (2026-08-23). The bulk route could carry it — a staged
 * entry already pairs an id with a parameterised act, so `move` already varies
 * its value per document — and it would be one member added to a union. Three
 * things decided against it:
 *
 * - **It is not a selection.** §10 gives that route one subject: a column's
 *   staged set, entered through bulk mode, saved once, reported in three parts
 *   (`changed`, `alreadyInState`, `refused`). A bar drag stages nothing and
 *   selects nothing, and none of the three parts says what a reorder needs to
 *   say. §9.2's rider enumerates the acts it carries — archive, unarchive,
 *   resolve, reopen, move, tag, mark still current, delete — so adding a ninth
 *   would contradict signed spec text and need its own sign-off.
 * - **It would open a general write path.** An `order` act reachable from a
 *   staged set is a way to write `order` onto *any* document, and rider 2 is
 *   explicit that a view document "has no `pinned` and no `order`". This route
 *   refuses anything that is not a `type: board` document, which is a
 *   restriction the bulk route has no place to state.
 * - **The arithmetic belongs to the server.** A caller here names the bar it
 *   wants; the positions are derived from the list's own order. A per-document
 *   `{id, order}` shape can express a contradiction (two boards at 3, a gap, a
 *   negative), and every caller would then have to renumber identically.
 *
 * The narrow route can be misused in exactly no way the wide one could.
 *
 * ## What the result says
 *
 * Every board named, with the position it **now** carries and whether this act
 * wrote it — the shape the folder acts already answer in ("the status each
 * document has after the act rather than a list of the ones that moved"), plus
 * the one sha, because "one commit" is the claim the rider makes and this is
 * where a caller can read it.
 */

/**
 * The spacing of a board bar: consecutive integers from one step, which is what
 * a reorder renumbers to and what the seed writes.
 *
 * Published because two places number boards and must not drift: this route
 * assigns `1 … n` over the list it is given, and a client putting a **new**
 * board last assigns the highest `order` plus one step. Neither derives the
 * other, and a step declared twice is a step that disagrees once.
 */
export const BOARD_ORDER_STEP = 1;

const BOARDS_DESCRIPTION =
  "**The bar, in the order it should be in** — every board this caller is ordering, by id, " +
  "first tab first. The positions are derived from the list: the first board is given `1`, the " +
  "next `2`, and so on in steps of one. A board already sitting at the number it would be given " +
  "is **not** written, because a write that changes nothing still stamps `updated` and lands a " +
  "line in the log the agent reads. An id may appear at most once — a board has one position, so " +
  "a repeat is a caller bug rather than something to resolve. Boards this list does not name are " +
  "left exactly as they are, which is what lets a bar that hides archived boards state its own " +
  "order without inventing positions for boards nobody can see.";

/**
 * The request: the ordered ids, and nothing else.
 *
 * **A list rather than `{id, order}` pairs.** The pairs can spell a
 * contradiction — two boards at `3`, a gap, a zero — and every client would
 * have to agree on the same renumbering to avoid one. A sequence has exactly
 * one reading, and it is the reading a person's drag produced.
 *
 * `min(1)` because a reorder of nothing is a caller bug, and a `200` naming no
 * board would let a broken bar look healthy — the rule `BulkActionRequest`
 * applies to a staged set holding nothing.
 */
export const ReorderBoardsRequestSchema = openapi(
  z
    .strictObject({
      boards: z.array(DocumentIdSchema).min(1).describe(BOARDS_DESCRIPTION),
    })
    .superRefine(({ boards }, ctx) => {
      const seen = new Set<string>();
      boards.forEach((id, index) => {
        if (!seen.has(id)) {
          seen.add(id);
          return;
        }
        ctx.addIssue({
          code: "custom",
          path: ["boards", index],
          message:
            `\`${id}\` is named twice. A board has one position on the bar (SPEC.md §10), so a ` +
            "repeat cannot be resolved into an order — name each board once.",
        });
      });
    }),
  "ReorderBoardsRequest",
);

export const BoardPositionSchema = openapi(
  z.object({
    id: DocumentIdSchema.describe("The board this position is about."),
    order: z
      .number()
      .int()
      .describe(
        "The position this board **now** carries — its place in the list the request sent, " +
          "counting from one. Read back from the document rather than predicted, so a caller " +
          "renders what the corpus holds.",
      ),
    changed: z
      .boolean()
      .describe(
        "Whether this act wrote the board's file. False for a board already at that position: " +
          "nothing was written for it and nothing about it is in `commit`. A caller reporting " +
          '"how many boards moved" counts these, never the length of the list it sent.',
      ),
  }),
  "BoardPosition",
  {
    description:
      "One board and where it sits after the reorder. Every board the request named is here, " +
      "in the order it asked for, whether or not this act had to write it.",
  },
);

export const ReorderBoardsResultSchema = openapi(
  z.object({
    boards: z
      .array(BoardPositionSchema)
      .describe(
        "Every board the request named, in the order it asked for, each with the position it now " +
          "carries and whether this act wrote it. The act is all-or-nothing, so this is the " +
          "order the corpus holds — never a partial one.",
      ),
    commit: z
      .string()
      .nullable()
      .describe(
        "The **single** auto-commit this reorder landed as (SPEC.md §4), authored by the acting " +
          "party, containing exactly the board documents whose position changed. One sha, never " +
          'a list: that is the whole of what rider 2\'s "in one commit" promises, and it is why ' +
          "this route exists rather than one `PUT` per board. Null in three cases, none of them " +
          "an error — every board was already at its position, so there was nothing to commit; " +
          "the workspace is not a git repository (`commit_skipped` in `warnings`); or the " +
          "workspace's hooks rejected the commit, leaving the writes on disk and uncommitted " +
          "(`commit_failed` in `warnings`, §11).",
      ),
    warnings: warningsField,
  }),
  "ReorderBoardsResult",
);

export type ReorderBoardsRequest = z.infer<typeof ReorderBoardsRequestSchema>;
export type BoardPosition = z.infer<typeof BoardPositionSchema>;
export type ReorderBoardsResult = z.infer<typeof ReorderBoardsResultSchema>;
