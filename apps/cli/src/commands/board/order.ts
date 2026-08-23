import type { BoardPosition, ReorderBoardsResult } from "@corpus/contract";
import { plural, warningSuffix } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { renderColumns } from "../columns.js";

/**
 * `corpus board order` — the board bar, renumbered in one act and one commit
 * (SPEC.md §10 rider 2, §9.2's `POST /api/boards/order`).
 *
 * ## Why the agent needs a verb and not a loop
 *
 * The agent's whole surface is this CLI (§2, CLAUDE.md Architecture Decision 2),
 * and before this verb its only lever on a board's position was
 * `corpus doc edit <id> --order N`, one document at a time — the exact shape
 * PR #58's review condemned in the UI's `moveBoard`. It did usually produce one
 * commit anyway, because §4's commit window folds a *party's* consecutive
 * writes. That is the problem rather than the defence: it made the rider's "in
 * one commit" an accident of timing, and the window can close between two
 * writes. Here it is a property of the act — the server writes every board that
 * moved as one group and lands one sha (CLI-063).
 *
 * ## What it prints
 *
 * One row per board, in the order asked for, with **the position it now carries
 * and whether this act wrote it**. That is the server's own answer, not a
 * prediction: a board already sitting where the request would put it is not
 * written, so a caller reporting "how many boards moved" counts the rows that
 * say `moved` and never the length of the list it sent.
 *
 * The summary names the single commit, because that sha is the whole of what
 * rider 2 promises and the only place a caller can check it. A null commit is
 * three different facts and the line says which: nothing moved so there was
 * nothing to commit, or the write happened and the commit did not — which
 * arrives as a `commit_skipped` or `commit_failed` warning (§11) and is
 * reported, never swallowed.
 *
 * **Nothing is validated here.** A repeated id, an id that names no document,
 * and an id that names something other than a `type: board` are all the route's
 * refusals, stated in the route's own words (`400`/`404`). Restating them in the
 * CLI would be a second copy of a rule the server owns, and the copy would be
 * the one that goes stale.
 */

export async function runBoardOrder(context: WorkspaceCommandContext): Promise<void> {
  const boards = [...context.args.list("id")];

  const result = await context.client.request((api) =>
    api.POST("/api/boards/order", { body: { boards } }),
  );

  context.out.emit(result);
  for (const line of renderColumns(result.boards.map(positionRow))) context.out.line(line);
  context.out.line(summaryLine(result));
}

function positionRow(position: BoardPosition): readonly string[] {
  return [position.id, String(position.order), position.changed ? "moved" : "unchanged"];
}

/**
 * The one line that carries the rider's claim.
 *
 * It never says "committed" without a sha to show for it, because "in one
 * commit" is the promise being made and an unverifiable promise is worse than
 * none. The three reasons a commit can be absent are distinguished: nothing to
 * write, or something written that git did not take — and the second arrives
 * with the server's own warning appended.
 */
export function summaryLine(result: ReorderBoardsResult): string {
  const moved = result.boards.filter((position) => position.changed).length;
  const head = `ordered ${plural(result.boards.length, "board")} — ${
    moved === 0 ? "none moved" : `${plural(moved, "board")} moved`
  }`;
  const tail =
    result.commit !== null
      ? `, in one commit ${result.commit}`
      : moved === 0
        ? ", so nothing was written"
        : ", not committed";
  return `${head}${tail}${warningSuffix(result.warnings)}`;
}

export const orderCommand: WorkspaceCommandSpec = {
  name: "order",
  summary: "Set the order of the board bar, in one act and one commit.",
  description:
    "Renumbers the boards named to `1 … n`, in the order given, through " +
    "`POST /api/boards/order` — and lands every write as the **single** auto-commit SPEC.md §4 " +
    "requires, which is rider 2's _reordering boards writes `order` on every board, in one " +
    "commit_. The alternative is `corpus doc edit <id> --order N` per board, and that makes one " +
    "commit only by accident: §4's window folds a party's consecutive writes, so it holds only " +
    "until the window closes between two of them. Here it is a property of the act.\n\n" +
    "**Name the whole bar, first tab first.** The positions come from the list — the first board " +
    "is given `1`, the next `2` — so there is no way to spell a contradiction, no gap and no " +
    "tie to resolve. A board already sitting at the number it would be given is **not** written: " +
    "a write that changes nothing still stamps `updated` and lands a line in the log, so a bar " +
    "dragged back where it started writes nothing at all.\n\n" +
    "**It names the bar, not the corpus.** Boards the list does not name keep the `order` they " +
    "carry, which is what lets a caller that shows only unarchived boards state its own order " +
    "without inventing positions for boards nobody can see.\n\n" +
    "One row per board, in the order asked for: the id, the position it **now** carries, and " +
    "`moved` or `unchanged`. Then one line naming the single commit — count the `moved` rows " +
    "rather than the ids you sent when reporting how many boards moved. **All or nothing**: an " +
    "id that names no document is a `404` and an id that names something other than a " +
    "`type: board` document is a `400`, both refused before anything is written, so no caller " +
    "ever sees half an order. An id named twice is a `400` too — a board has one position, so a " +
    "repeat cannot be resolved into an order.",
  args: [
    {
      name: "id",
      required: true,
      variadic: true,
      description:
        "The boards, in the order the bar should be in — first tab first. Each named once.",
    },
  ],
  flags: [],
  examples: [
    {
      command: "corpus board order doc_inbox doc_attention doc_files --from agent",
      description:
        "Put Inbox first, Attention second, Files third. One act, one commit, and only the boards whose position actually changed are written.",
    },
    {
      command: "corpus board order doc_attention doc_inbox --json | jq -r .commit",
      description:
        "The single sha the reorder landed as — `git show` it to see every board it wrote. Null when no board had to move.",
    },
    {
      command:
        "corpus doc list --type board --sort order --json | jq -r '.items[].id' | tail -r | xargs corpus board order --from agent",
      description:
        "Reverse the bar: read the boards in their current order, hand them back reversed. The list is the order, so nothing has to compute positions.",
    },
  ],
  handler: (context) => runBoardOrder(context),
};
