import { plural } from "../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../registry/types.js";
import { formatAge } from "./age.js";

/**
 * `corpus reflect` — the ask, and the clock (SPEC.md §7, rider 9 signed
 * 2026-08-22).
 *
 * **Reflection is an act over the whole corpus, never a side effect of one
 * change.** A stage moved, a status flipped, a tag, a move, an archive: none of
 * them enqueues anything. What reaches the agent is one `workspace.reflect`
 * event carrying one timestamp — `since`, the corpus's last reflection — and the
 * agent gathers the window itself with `corpus doc list --since`, reading what
 * it chooses and paying only for that.
 *
 * Two verbs in one because they are one resource read two ways, which is why the
 * contract gives them one path and two methods. Bare, it asks. With `--status`,
 * it reads the clock, which is what the board bar's Reflect control renders.
 *
 * **A second ask is answered, never refused.** Ten people pressing Reflect
 * produce one reflection, and the tenth is told so: the response names the event
 * already pending or in progress and sets `pending: true`. That is exit **0**,
 * deliberately — asking for what is already happening is not an error, and no
 * different command would change the answer. A caller that needs to tell the two
 * apart reads `pending` under `--json` rather than an exit code.
 */

export async function runReflect(context: WorkspaceCommandContext): Promise<void> {
  if (context.flags.boolean("status")) return reportClock(context);

  const result = await context.client.request((api) => api.POST("/api/workspace/reflect"));

  context.out.emit(result);
  context.out.line(
    `${result.pending ? "already reflecting" : "reflecting"} — ${result.eventId}, window since ${
      result.since ?? "the beginning"
    }`,
  );
}

async function reportClock(context: WorkspaceCommandContext): Promise<void> {
  const status = await context.client.request((api) => api.GET("/api/workspace/reflect"));

  context.out.emit(status);
  context.out.line(
    `reflected ${describeClock(status.reflected)} · ${plural(status.changed, "document")} changed since`,
  );
  context.out.line(
    status.pending === null
      ? `nothing pending · quiet window ${describeQuiet(status.quiet)}`
      : `reflecting now (${status.pending}) · quiet window ${describeQuiet(status.quiet)}`,
  );
  if (status.lastDigest !== null) context.out.line(`last digest ${status.lastDigest}`);
}

/**
 * "3h ago (2026-08-22T09:00:00Z)", or the honest answer for a corpus nothing has
 * ever reflected on — which is not "never" alone, because `null` there also
 * means the window is *everything*, and that is what the agent's gather does
 * with it.
 */
function describeClock(reflected: string | null): string {
  if (reflected === null) return "never — the window is the whole corpus";
  const at = Date.parse(reflected);
  return Number.isNaN(at) ? reflected : `${formatAge(Date.now() - at)} ago (${reflected})`;
}

/** `0` is not "immediately": it is the automatic path switched off (SPEC.md §7). */
function describeQuiet(minutes: number): string {
  return minutes === 0 ? "off (asking is the only way)" : `${String(minutes)}m`;
}

export const reflectCommand: WorkspaceCommandSpec = {
  name: "reflect",
  summary: "Ask the agent to reflect on the whole corpus, or read the reflection clock.",
  description:
    "**Reflection is an act over the whole corpus, never a side effect of one change** (SPEC.md " +
    "§7). A stage moved, a status flipped, a tag, a move, an archive: none of them enqueues " +
    "anything. This verb enqueues the one event that does — `workspace.reflect`, carrying a " +
    "single timestamp, `since`, the corpus's last reflection — and the agent gathers the window " +
    "itself with `corpus doc list --since`, reads what it chooses, and pays only for that. The " +
    "event falls in no scope and takes the orchestrator's lane.\n\n" +
    "**An ask while one is pending is answered with the pending one, never doubled and never " +
    "refused.** Ten people pressing Reflect produce one reflection; the tenth is told so and " +
    "given that event's id, at **exit 0**, because asking for what is already happening is not " +
    "an error and no different command would change the answer. A caller that needs to tell an " +
    "ask that enqueued something from one that did not reads `pending` under `--json`.\n\n" +
    "**`--status` reads the clock instead of touching it**: when the corpus was last reflected " +
    "on, whether a reflection is running, **how many documents are unreflected**, the digest " +
    "thread of the last one, and the configured quiet window. Unreflected means changed since " +
    "the clock by someone **other than the agent** and not archived — what a reflection produces " +
    "is its output, not new work for it. `reflect.quiet` is the other way a reflection happens: " +
    "the server enqueues one by itself when something changed after the clock, nothing has " +
    "changed for that long, and none is pending, so ten changes in five minutes are one " +
    "reflection half an hour later. A quiet window of `0` disables that path and leaves asking " +
    "as the only way.\n\n" +
    "It writes a queue event and no document, so it makes no commit — but it still carries " +
    "`--from`, which records who asked in the job log and the digest thread.",
  args: [],
  flags: [
    {
      name: "status",
      type: "boolean",
      description:
        "Read the clock instead of asking: when the corpus was last reflected on, what is " +
        "pending, how many documents are unreflected, the last digest thread, and the quiet " +
        "window. Sends nothing and changes nothing.",
    },
  ],
  examples: [
    {
      command: "corpus reflect",
      description:
        "Ask for a reflection now. Prints the event id and the start of the window it will cover; if one was already pending it says so and names that event, at exit 0.",
    },
    {
      command: "corpus reflect --status",
      description:
        "The board bar's Reflect control, in a terminal: the clock, how many documents are unreflected, whether one is running, and the quiet window.",
    },
    {
      command: "corpus reflect --json",
      description:
        'One JSON value — `{"eventId":"evt_a1b2","since":"2026-08-22T09:00:00Z","pending":false}`. `pending` is what distinguishes an ask that enqueued a reflection from one that joined the pending one.',
    },
  ],
  handler: (context) => runReflect(context),
};
