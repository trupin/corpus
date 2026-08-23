import { badRequest } from "../errors.js";

/**
 * **`order` is a board's position among boards, and nothing else** (SPEC.md §10,
 * rider 2, signed 2026-08-22, and the field's own published description).
 *
 * `POST /api/boards/order` has refused a non-board since the rider landed. The
 * two **general** write paths did not, and they are the ones every client uses:
 * `corpus doc edit <view-id> --order 5` answered `200` and left `order: 5` on a
 * saved query, and `corpus doc create --type view --order 7` let one be born
 * with the number already on it. Phase 41's migration told people to unset that
 * exact key (CLI-061), and nothing stopped it being put straight back. An
 * accepted write is a promise that the value will be read.
 *
 * **One assertion, called from both paths** (SERVER-143, create half added on
 * the orchestrator's decision, 2026-08-23). Two guards that agreed on the day
 * they were written is how `POST /api/boards/order` and `PUT /api/docs/{id}`
 * came to disagree in the first place, so the status, the field path, the type
 * test and the sentence live here and nowhere else.
 *
 * Three properties, and each one has a reader it protects:
 *
 * - **Only a value being written.** `undefined` and `null` both pass. On update
 *   `undefined` is `setFrontmatterFields`' spelling for deleting a key, which is
 *   what `order: null` and `unset: ["order"]` both become — the two ways the
 *   migration clears the field, and refusing them would strand exactly the
 *   documents the rider exists to clean up. On create a `null` "is the same as
 *   omitting it: no `order` key", which the contract says in as many words.
 * - **Anything that is not a board**, rather than a view alone. The wire says
 *   "**It is a board's position and nothing else**", and `planBoard` already
 *   draws its line at `type !== "board"`.
 * - **`400`**, which both routes already declare. The remedy is to drop the
 *   field and send the request again, and that is what a `400` tells a caller to
 *   do. `PUT`'s `409` is §7's stale key and nothing else.
 *
 * **The no-op exemption is the update path's alone, and does not generalise.**
 * A save that re-sends the `order` a legacy view already carries is allowed
 * through, because `changedFields` has already dropped it and a reader that
 * autosaves the frontmatter it was shown must not lock the document. Creation
 * has no analogue: there is no stored value to match, and every field in a
 * create request is a value the caller deliberately asked to be written. So the
 * update call site passes the **computed change**, and the create call site
 * passes the **request's own field** — the same rule, asked of the thing each
 * path actually writes.
 *
 * `planBoard` in `board-order.ts` keeps its own refusal rather than calling
 * this: it answers about one entry of a list, so its issue path is
 * `boards[<index>]` and its message names which id in the batch was wrong.
 * Different question, different shape — this is about a field of one body.
 *
 * @param subject How the message names the document — an id where there is one,
 *   a noun phrase at creation, where there is not yet.
 * @param type The document's type. On update it is the **projection row's**, the
 *   answer every reader was given, for the reason `currentOrigin` records: a
 *   write must ask the question the reader answered.
 * @param order The value about to be written, if any.
 * @param recovery The one sentence that differs between the paths, because the
 *   way out genuinely differs: an existing document drops the key, a caller
 *   creating one omits the field.
 */
export function assertOrderIsABoardPosition(
  subject: string,
  type: string,
  order: unknown,
  recovery: string,
): void {
  if (order === undefined || order === null) return;
  if (type === "board") return;
  throw badRequest("request failed validation", [
    {
      path: "body.order",
      message:
        `${subject} is a \`${type}\` document, not a board: \`order\` is a board's position among ` +
        "boards and nothing else (SPEC.md §10). Boards are reordered with " +
        "`POST /api/boards/order`; a view is a saved query with no position of its own, and the " +
        `same view may sit on two boards. ${recovery}`,
    },
  ]);
}

/** The way out of the refusal for a document that already exists. */
export const ORDER_RECOVERY_ON_UPDATE =
  'A document that still carries the key from before the rule can drop it with `unset: ["order"]`.';

/** The way out for a caller creating a document. */
export const ORDER_RECOVERY_ON_CREATE =
  "Omit the field, or create the document with `type: board`.";
