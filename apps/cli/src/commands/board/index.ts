import type { TopicSpec } from "../../registry/types.js";
import { orderCommand } from "./order.js";

/**
 * The board acts — and there is deliberately **one** (SPEC.md §10, CLI-063).
 *
 * A board is a document (§10). It is created, retitled, archived and deleted
 * through `corpus doc`, and its columns, its kanban block and its stage are
 * frontmatter that `corpus doc edit` writes. None of that belongs here, and a
 * `corpus board create` beside `corpus doc create --type board` would be two
 * ways to make one thing — the drift the one-registry rule (§2.3) exists to
 * prevent.
 *
 * What belongs here is the act whose subject is the **set** rather than any one
 * document. `order` is a board's position *among boards* (§10 rider 7), so
 * reordering is a statement about the bar: it renumbers every member at once,
 * and rider 2 says what that costs — "reordering boards writes `order` on every
 * board, in one commit". A per-document verb cannot say that, which is why the
 * contract gave the act a route of its own and why the agent gets a verb of its
 * own for it.
 *
 * So the rule for anything proposed here later is short: if the act is about one
 * board, it is a `corpus doc` verb. If it is about the bar, it is this topic.
 */
export const boardTopic: TopicSpec = {
  name: "board",
  summary: "Acts on the board bar as a set — today, its order.",
  description:
    "A board is a document (SPEC.md §10), so everything that happens to **one** board happens " +
    "through `corpus doc`: `corpus doc create --type board` makes one, `corpus doc edit` writes " +
    "its `columns`, its `kanban` block and its title, and `corpus doc archive` takes it off the " +
    "bar. This topic is for the acts whose subject is the **bar itself**, and there is one of " +
    "them.\n\n" +
    "`order` renumbers every board named, in the order given, and lands the whole renumbering as " +
    "the single auto-commit §4 requires — rider 2's _reordering boards writes `order` on every " +
    "board, in one commit_. Doing the same with `corpus doc edit <id> --order N` per board makes " +
    "one commit only while §4's window happens to stay open across the writes, which is not a " +
    "property anything can rely on.",
  commands: [orderCommand],
};
