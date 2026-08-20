import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { residentLabel } from "../resident.js";

/**
 * `corpus thread show` — the read half of the conversation surface (SPEC.md §6,
 * §8). §7's comment skill reads a thread before it replies, and a thread's state
 * lives in the projection as much as in its file: which document it hangs off,
 * whether the anchor still resolves, and whether the agent is engaged are
 * answers the server owns.
 *
 * **It renders exactly what `GET /api/threads/{id}` returns** — turns, status,
 * agent state, parent and anchor (sprint-013 Adjudication 14). The endpoint
 * carries no `events` array and no read-state, so this verb reports neither: a
 * fabricated unread flag would be worse than none, and the only read-state
 * endpoint is a *mutation* (`POST /api/threads/{id}/seen`), which a read verb
 * must never call — showing a thread would silently clear its unread badge in
 * the board.
 *
 * The three thread shapes §7's skill branches on are named in the output rather
 * than left to be inferred from two nulls: anchored to a selection, on a whole
 * document, or standalone.
 */

/** What an absent value renders as, matching `corpus doc show`. */
const NONE = "—";

export async function runThreadShow(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");
  const thread = await context.client.request((api) =>
    api.GET("/api/threads/{id}", { params: { path: { id } } }),
  );

  context.out.emit(thread);

  context.out.line(thread.title);
  context.out.line(`${thread.id} · ${thread.status} · agent ${thread.agent}`);
  context.out.line(
    `parent ${thread.parent ?? NONE} · anchor ${thread.anchor ?? NONE} · ${shapeOf(thread.parent, thread.anchor)}`,
  );
  // Printed only when there is one, because absence is the ordinary state of
  // almost every thread and a `resident —` line on all of them would be noise
  // (SPEC.md §7: dissolving is the absence of a resident, never a third state).
  //
  // It reports the **designation** and says nothing about whether that agent is
  // running: liveness belongs to one lane's roster row, is read from a different
  // endpoint, and the two may legitimately disagree for a grace window. Printing
  // both here would present them as one fact. `corpus agents` is where presence
  // is answered.
  //
  // Rendered through the shared label, because since SHARED-048 a resident's
  // `name` and `docId` are each nullable and the three combinations mean three
  // different things — interpolating them raw printed `resident null · null` for
  // the ordinary case.
  const resident = thread.resident;
  if (resident !== null && resident !== undefined) {
    context.out.line(`resident ${residentLabel(resident)}`);
  }
  context.out.line(`created ${thread.created} · updated ${thread.updated}`);
  context.out.line(`tags ${thread.tags.length === 0 ? NONE : thread.tags.join(", ")}`);

  if (thread.turns.length === 0) {
    context.out.line("");
    context.out.line("(no turns)");
    return;
  }

  // Oldest first, as the wire orders them: a conversation read backwards is a
  // different conversation.
  for (const turn of thread.turns) {
    context.out.line("");
    context.out.line(`${turn.author} · ${turn.ts}`);
    context.out.line(turn.body.trimEnd());
  }
}

/** The three shapes a thread can have (SPEC.md §6), named rather than implied. */
function shapeOf(parent: string | null, anchor: string | null): string {
  if (parent === null) return "standalone";
  return anchor === null ? "whole document" : "anchored to a selection";
}

export const showCommand: WorkspaceCommandSpec = {
  name: "show",
  summary: "Read a conversation: its status, its anchoring, and every turn.",
  description:
    "Reads `GET /api/threads/{id}` and renders it as the wire returns it — title, status, agent " +
    "state, parent, anchor and every turn oldest first, each with its author and timestamp. The " +
    "anchoring line names which of the three shapes the thread has: anchored to a selection, on " +
    "a whole document (`parent` set, no anchor), or standalone (neither). This is the context " +
    "SPEC.md §7's comment skill reads before it replies. A designated thread also prints a " +
    "`resident` line naming the agent that owns the conversation, with the `agent-def` document " +
    "that defines it where it has one — a resident designated with no profile prints as `a " +
    "general resident`, and one whose profile has since been renamed, deleted, or moved out of " +
    "`.claude/agents/` prints `name (profile missing)`. **Archiving is not one of those**: an " +
    "archived `agent-def` still under that root resolves exactly as before, and is still " +
    "designatable, so the line keeps printing its id. Where the designation chose a weight " +
    "(SPEC.md §7, rider signed 2026-08-19) the line names it after the resident — `resident a " +
    "general resident at heavy` — with the word taken from this workspace's own agent guidance " +
    "rather than being a model name, and a designation that chose none prints nothing extra. " +
    "An undesignated thread prints no such line, because having nobody " +
    "resident is the ordinary state rather than a value. That line reports the **designation** " +
    "and says nothing " +
    "about whether the agent is currently running — presence is one lane's row in " +
    "`corpus agents`, and the two are separate reads that may honestly disagree for a moment. " +
    "**No read-state is reported**: the " +
    "endpoint carries none, and the only endpoint that does is a mutation — reading a thread " +
    "must not clear its unread badge. A thread id that names nothing is the server's `404`, " +
    "which is exit 5.",
  args: [{ name: "id", required: true, description: "The thread's id." }],
  flags: [],
  examples: [
    {
      command: "corpus thread show th_a1b2c3",
      description: "Read a conversation before replying to it.",
    },
    {
      command: "corpus thread show th_a1b2c3 --json",
      description:
        'One JSON value: `{"id":"th_a1b2c3","title":"Is 6.1% right?","created":' +
        '"2026-07-28T10:00:00.000Z","updated":"2026-07-28T10:05:00.000Z","status":"open",' +
        '"tags":[],"parent":"doc_a1b2c3","anchor":"anc_1","agent":"engaged","resident":null,"turns":' +
        '[{"author":"user","ts":"2026-07-28T10:00:00.000Z","body":"Is 6.1% right?"}]}`.',
    },
  ],
  handler: (context) => runThreadShow(context),
};
