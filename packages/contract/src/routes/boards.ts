import { createRoute } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { ReorderBoardsRequestSchema, ReorderBoardsResultSchema } from "../schemas/boards.js";
import {
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * The board bar's one act (SPEC.md §10, rider 2 signed 2026-08-22).
 *
 * Every other thing that happens to a board happens to its **document** — it is
 * created, renamed, archived and deleted through `/api/docs`, and its columns
 * and its kanban block are frontmatter a `PUT` writes. A reorder is the one act
 * whose subject is the **set** rather than any one document, and the rider says
 * what that costs: "reordering boards writes `order` on every board, in one
 * commit". The reasoning behind the route, and why the bulk route was not
 * extended to carry it, is in `schemas/boards.ts`.
 */
export const reorderBoards = createRoute({
  method: "post",
  path: "/api/boards/order",
  tags: ["boards"],
  summary: "Set the order of the board bar, in one commit",
  description:
    "Renumbers the boards named in the body to `1 … n`, in the order given, and lands every " +
    "write as the **single** auto-commit SPEC.md §4 requires — rider 2's \"reordering boards " +
    'writes `order` on every board, in one commit". A board already at the position it would be ' +
    "given is left alone, so the commit contains exactly the documents whose position changed " +
    "(§4) and a bar dragged back where it started writes nothing at all.\n\n" +
    "**All or nothing.** The whole request is refused before anything is written when an id " +
    "names no document (`404`) or names a document that is not a `type: board` (`400` — rider 2: " +
    "a view document has no `order`), and the file writes are applied as one group that rolls " +
    "back if any of them fails. No caller can observe half an order, which is the failure " +
    "one-`PUT`-per-board could not rule out.\n\n" +
    "**It names the bar, not the corpus.** Boards the body does not name keep the `order` they " +
    "carry, so a client showing only unarchived boards states its own order without inventing " +
    "positions for boards nobody can see. Two boards may then tie, which is the state a " +
    "hand-edited file can be in anyway, and `GET /api/docs?sort=order` breaks a tie by title and " +
    "then by id.\n\n" +
    "Authored by the acting party like every other write (§4), and the commit folds in neither " +
    "direction: it is an act over a set, so it never joins a preceding editing session and no " +
    "later save joins it.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The board bar, in the order it should be in.",
      content: { "application/json": { schema: ReorderBoardsRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      ReorderBoardsResultSchema,
      "Every board named, with the position it now carries and whether this act wrote it, plus " +
        "the one commit and any §11 warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
