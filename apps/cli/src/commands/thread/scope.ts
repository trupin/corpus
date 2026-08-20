import { SCOPE_PAGE_SIZE, type ScopeMember } from "@corpus/contract";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { oneLine, renderColumns } from "../columns.js";

/**
 * `corpus thread scope` — what a designated thread's resident owns (SPEC.md §7,
 * CONTRACT-068's `GET /api/threads/{id}/scope`).
 *
 * ## The question this answers, and who asks it
 *
 * §7 makes scope membership a **walk, not a label**: nothing carries a scope
 * marker, and the server works out at enqueue time whether an event falls inside
 * by following a thread's parents and a document's `origin` up to a lane. That
 * walk climbs. Until this endpoint nothing walked the other way, so *"what does
 * this agent own"* had no answer a person could read and *"what do I own"* had
 * none a resident could ask — and a resident that cannot see its own scope has
 * to guess at the boundary of its own job.
 *
 * CONTRACT-068 decision 4 asked whether the agent gets this listing too, and the
 * answer recorded on 2026-08-19 is yes: it is the same endpoint, the CLI is the
 * agent's only way to the server, and **reading your own lane is not a sweep**.
 * It is the one thing §7 says the resident owns.
 *
 * ## One frugal line per member, and never a body
 *
 * §7's retrieval discipline, and the same shape `corpus search` and
 * `corpus doc related` print: id first, then the fields worth branching on, then
 * the free text last where `renderColumns` leaves it ragged. Opening a member is
 * a separate, deliberate act — `corpus doc show <id>` or `corpus thread show
 * <id>`, which the `kind` column is there to choose between.
 *
 * ## The bound is the contract's, and this verb adds no paging to it
 *
 * The page is fixed at {@link SCOPE_PAGE_SIZE} with no cursor and no total,
 * because the bound exists so that a scope cannot be *enumerated* — not to make
 * paging a feature. So there is no `--limit` and no `--offset` to add here, and
 * the one thing this rendering owes a reader is to say when the cut happened:
 * `doc list`'s rule, that a page is never presented as the whole set. When
 * nothing was cut the listing **is** the whole set, and a tally saying so would
 * be a line that carries no information.
 *
 * ## Nothing is derived, filtered or re-ordered here
 *
 * The order is the server's — root first, then most recently updated first, so a
 * truncated page holds the live end of the scope — and `via` is the edge the
 * walk actually took, reported rather than re-computed. A second reading of the
 * scope rule in this CLI is exactly the drift `packages/kit`'s `scopeWalk.ts`
 * records the cost of.
 */

/** What a document with no title prints as, matching `corpus doc list`. */
const UNTITLED = "(untitled)";

/**
 * The line that keeps a cut listing from reading like a complete one, in the
 * shape `corpus doc list`'s tally set: what was shown, and what to do next.
 *
 * What to do next is **not** a next page, and the sentence says so rather than
 * leaving a reader to hunt for the flag that would fetch one. There is none by
 * design: a cursor here would turn the bound into a paging convenience and hand
 * back the enumeration §7 forbids.
 */
export const TRUNCATION_NOTICE =
  `showing the first ${String(SCOPE_PAGE_SIZE)} members — the scope holds more. There is no next ` +
  "page: the bound exists so that a scope cannot be enumerated, so read any further member by " +
  "its id.";

/**
 * What an empty listing means: a fault, not an empty scope.
 *
 * The root is always a member (`members[0].id` is the thread, `via: "self"`) and
 * a thread with no resident is the server's `409` rather than an empty `200`, so
 * no scope this verb can legitimately print has nothing in it. Reported the way
 * `corpus agents` reports an empty roster — on stderr, as a diagnostic about the
 * answer — rather than printed as silence a reader would take for "it owns
 * nothing".
 */
export const EMPTY_SCOPE_NOTE =
  "the server listed no members at all. The designated thread is always in its own scope, so " +
  "this is a fault in the server rather than a resident that owns nothing.";

export async function runThreadScope(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");

  const scope = await context.client.request((api) =>
    api.GET("/api/threads/{id}/scope", { params: { path: { id } } }),
  );

  context.out.emit(scope);

  if (scope.members.length === 0) {
    context.out.note(EMPTY_SCOPE_NOTE);
    return;
  }

  for (const line of renderRows(scope.members)) context.out.line(line);
  if (scope.truncated) context.out.line(TRUNCATION_NOTICE);
}

/**
 * One member per line, in the CLI's retrieval field order: the id an agent acts
 * on first, then the three short facts it branches on, then the title last
 * because it is the only free text and the only column worth leaving ragged.
 */
function renderRows(members: readonly ScopeMember[]): readonly string[] {
  return renderColumns(
    members.map((member) => [member.id, member.kind, member.status, member.via, title(member)]),
  );
}

function title(member: ScopeMember): string {
  const collapsed = oneLine(member.title);
  return collapsed === "" ? UNTITLED : collapsed;
}

export const scopeCommand: WorkspaceCommandSpec = {
  name: "scope",
  summary: "List what a designated thread's resident owns.",
  description:
    "Reads `GET /api/threads/{id}/scope` and prints the **scope** of a designated thread " +
    "(SPEC.md §7): the thread itself, every thread whose parent chain reaches it, every document " +
    "whose `origin` reaches it, and every thread on such a document — that is, everything whose " +
    "events are stamped with this thread's lane. A person asks it to see what an agent owns; a " +
    "resident asks it to learn what it owns, and **reading your own lane is not a sweep**.\n\n" +
    "**One line per member and never a body** (§7's retrieval discipline), in five columns: the " +
    "member's id, whether it is a `thread` or a `doc`, its own status, the edge it reached the " +
    "scope by, and its current title. Reading one is the separate act the `kind` column chooses " +
    "the verb for — `corpus thread show <id>` or `corpus doc show <id>`.\n\n" +
    "**The last column says how each member got in**, in the server's own vocabulary: `self` is " +
    "the designated thread, always the first row; `parent` is a thread whose parent chain reaches " +
    "it, directly or through a document in scope; `origin` is a document written by a job run " +
    "from this conversation, **including one written before the thread was designated**. A member " +
    "with both edges reports `parent`. It is the edge the walk took, reported rather than " +
    "re-derived — membership is computed per request by the same walk that routes the queue " +
    "(SPEC.md §7: scope is computed, never stored), so what is listed here is exactly what an " +
    "event posted there would be routed to this lane by.\n\n" +
    "**An archived document is still in scope** and says so in its status column: archiving " +
    "touches neither `origin` nor `parent`, and `corpus doc detach` is the only way out of a " +
    "scope.\n\n" +
    `**Bounded at ${String(SCOPE_PAGE_SIZE)} members, with no cursor, no total and no flags.** ` +
    "The root comes first, then the most recently updated members first, so a cut page holds the " +
    "live end of the scope. When the cut happens the last line says so — a capped list that " +
    "looked complete is what that line exists to prevent — and there is deliberately no next " +
    "page: the bound exists so that a scope cannot be enumerated, not to make paging a feature. " +
    "A caller that needs one particular member reads it by id.\n\n" +
    "**A thread with no resident is the server's `409`**, which is exit 5, not an empty listing: " +
    "§7 defines scope only for a designated thread, and everything outside every scope falls to " +
    "the orchestrator's lane by default — so an undesignated thread has no scope rather than an " +
    "empty one, and the refusal names the remedy. A thread id that names nothing, or a document " +
    "that is not a thread, is the server's `404`. Read-only: nothing here writes, and `--from` " +
    "changes nothing about the answer.",
  args: [{ name: "id", required: true, description: "The designated thread's id." }],
  flags: [],
  examples: [
    {
      command: "corpus thread scope th_4b8e2c",
      description:
        "One padded line per member — `doc_aefyz2pg  doc  archived  origin  Findings` — the root " +
        "first, then the most recently updated. Open one with the verb its `kind` names.",
    },
    {
      command: "corpus thread scope th_4b8e2c --json",
      description:
        'The listing verbatim: `{"thread":"th_4b8e2c","members":[{"id":"th_4b8e2c",' +
        '"kind":"thread","title":"Q3 planning","status":"open","via":"self"},…],' +
        '"truncated":false}`. `truncated` is the field to branch on — there is no cursor and no ' +
        "total, so a `true` there means read what you still need by id.",
    },
    {
      command:
        "corpus thread scope th_4b8e2c --json | jq -r '.members[] | select(.kind==\"doc\") | .id'",
      description: "Every document this resident owns, one id per line, ready to read one by one.",
    },
  ],
  handler: (context) => runThreadScope(context),
};
