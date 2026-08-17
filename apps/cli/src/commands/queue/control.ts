import type { QueueStatus } from "@corpus/contract";
import type { Output } from "../../output.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { GRACE_WINDOW, presenceOf, sinceAge } from "../agents.js";

/**
 * The kill switch and the recovery verbs (SPEC.md §7). Halting stops
 * **consumption**, never production: comments keep enqueuing while the queue is
 * halted, and resuming makes them visible again.
 */

/**
 * The depth line, in the lifecycle order `QUEUE_EVENT_STATUSES` declares.
 * `deferred` sits between the live states and the terminal ones because that is
 * what it is (SPEC.md §7, CONTRACT-021): work parked while a person edits the
 * document it needs, which returns to `pending` by itself when that session
 * ends. Reading it next to `failed` is the misreading the separate count exists
 * to prevent.
 */
function reportStatus(out: Output, status: QueueStatus, headline: string): void {
  out.emit(status);
  out.line(
    `${headline} — pending ${String(status.pending)}, in-progress ${String(status.inProgress)}, ` +
      `deferred ${String(status.deferred)}, processed ${String(status.processed)}, ` +
      `failed ${String(status.failed)}, abandoned ${String(status.abandoned)}`,
  );
}

export async function runHalt(context: WorkspaceCommandContext): Promise<void> {
  const reason = context.flags.string("reason");
  // A bare halt sends no body: the contract's `reason` is `min(1)`, so
  // `{"reason":""}` would be a 400, and the sentinel distinguishes "halted" from
  // "halted for a reason".
  const withReason = reason !== undefined && reason.trim() !== "";
  const status = await context.client.request((api) =>
    api.POST("/api/queue/halt", withReason ? { body: { reason } } : {}),
  );
  reportStatus(context.out, status, withReason ? `queue halted (${reason})` : "queue halted");
}

export async function runResume(context: WorkspaceCommandContext): Promise<void> {
  const status = await context.client.request((api) => api.POST("/api/queue/resume"));
  reportStatus(context.out, status, "queue resumed");
}

/**
 * **Whether anybody is there to work the queue** — the second half of the answer
 * `corpus queue status` is asked for (CLI-046).
 *
 * The counts describe the work; this describes the worker, and depth alone
 * cannot tell *nobody has picked this up yet* from *nobody is there to pick it
 * up*. Those are the two explanations a reader is choosing between when nothing
 * is happening, and they call for opposite responses — wait, or start a
 * listener.
 *
 * It is `QueueStatus.agent` rendered and nothing more: no liveness arithmetic
 * (the grace window is applied server-side, before `live` is answered), and no
 * second read of `GET /api/agents` to corroborate it. CONTRACT-053 records that
 * the two can legitimately disagree for one grace window — a listener parked on
 * a lane whose designation has just been released is present, and has no roster
 * row — so a line that blended them would be one fact fewer than it looks. The
 * per-lane detail is `corpus agents`, said in the same words as here.
 *
 * The vocabulary is `corpus agents`' own ({@link presenceOf}), read at the
 * workspace's grain: `live` becomes *an agent is here*, and its two falses stay
 * apart because they mean different things to whoever is reading.
 */
export function presenceLine(status: QueueStatus, now: number): string {
  if (!carriesPresence(status)) return UNKNOWN_PRESENCE;

  const presence = presenceOf(status.agent);
  // The server answered, and it has observed no park at all — including just
  // after a restart, since presence is held in memory and nothing about it is
  // persisted. An absence with evidence behind it, unlike the case above.
  if (presence === "waiting") return "no agent — none has parked since the server started";

  const parked = sinceAge(status.agent.since, now);
  if (presence === "live") {
    return parked === null ? "agent present" : `agent present, parked ${parked} ago`;
  }
  return parked === null ? "no agent" : `no agent — last parked ${parked} ago`;
}

/**
 * **A status that did not tell us is not a status telling us nobody is there.**
 *
 * `agent` is required on the wire (CONTRACT-045) and filled from a real tracker
 * (SERVER-112), so by the types this can only be false. It is written anyway,
 * for the reason UI-098 gives about the console strip: the value arrives off the
 * network, and a server built before the field existed, a proxy that trimmed it,
 * or a stub answering `{}` all reach here. Reading a missing field as absence
 * would print the strongest claim on the thinnest evidence — the exact mistake
 * this line was added to stop the counts making by elimination.
 */
function carriesPresence(status: QueueStatus): boolean {
  const presence: unknown = status.agent;
  return typeof presence === "object" && presence !== null && "live" in presence;
}

export const UNKNOWN_PRESENCE = "agent presence unknown — this server did not report it";

/**
 * The one verb that answers "why is nothing happening", so the only one of the
 * three that prints presence.
 *
 * `halt` and `resume` return the same `QueueStatus` and deliberately do not:
 * they are acts, and their one line reports what the act did. A person halting
 * the queue is not asking who is listening, and `corpus queue status` — or
 * `corpus agents`, for the per-lane version — is one keystroke away.
 */
export async function runStatus(context: WorkspaceCommandContext, now = Date.now()): Promise<void> {
  const status = await context.client.request((api) => api.GET("/api/queue/status"));
  reportStatus(context.out, status, status.halted ? "queue halted" : "queue running");
  context.out.line(presenceLine(status, now));
}

export async function runReapStale(context: WorkspaceCommandContext): Promise<void> {
  const result = await context.client.request((api) => api.POST("/api/queue/reap-stale"));
  context.out.emit(result);
  // Nothing stale is the common case and says nothing worth a line.
  if (result.reaped.length === 0) return;
  context.out.line(
    `returned ${String(result.reaped.length)} stale event(s) to pending: ${result.reaped.join(", ")}`,
  );
}

export const haltCommand: WorkspaceCommandSpec = {
  name: "halt",
  summary: "Stop the agent consuming events.",
  description:
    "Writes the `.corpus/HALT` sentinel. While halted, `claim-all` returns an empty batch and " +
    "`idle` parks for its full window without ever returning events — but events keep enqueuing, " +
    "so nothing is lost and `resume` makes them available again. Idempotent: halting an " +
    "already-halted queue re-records the sentinel. A bare halt sends no body; `--reason` is " +
    "recorded beside the halt timestamp so whoever finds the queue stopped can see why, and a " +
    "later bare halt rewrites the sentinel without one.",
  args: [],
  flags: [
    {
      name: "reason",
      type: "string",
      valueName: "text",
      description: "Why the queue is halted, recorded in the `.corpus/HALT` sentinel.",
    },
  ],
  examples: [
    { command: "corpus queue halt", description: "Stop the agent from picking up work." },
    {
      command: 'corpus queue halt --reason "migrating the corpus"',
      description: "Halt with a note for whoever finds it stopped.",
    },
  ],
  handler: (context) => runHalt(context),
};

export const resumeCommand: WorkspaceCommandSpec = {
  name: "resume",
  summary: "Let the agent consume events again.",
  description:
    "Removes the `.corpus/HALT` sentinel. Events that arrived while halted are still pending, so " +
    "the next `idle` returns them. Idempotent: resuming a running queue is not an error.",
  args: [],
  flags: [],
  examples: [{ command: "corpus queue resume", description: "Lift the halt." }],
  handler: (context) => runResume(context),
};

export const statusCommand: WorkspaceCommandSpec = {
  name: "status",
  summary: "Show the halt state, the queue depth, and whether an agent is there.",
  description:
    "Reads `GET /api/queue/status`: whether the queue is halted, plus how many events sit in each " +
    "of `pending`, `in-progress`, `deferred`, `processed`, `failed` and `abandoned`. A non-zero " +
    "`deferred` is **not** breakage — those events are waiting on a person's edit session and " +
    "return to `pending` on their own when it ends (SPEC.md §7).\n\n" +
    "A second line says **whether anybody is there to work it**, because the depth alone cannot " +
    "tell _nobody has picked this up yet_ from _nobody is there to pick it up_ — the two " +
    "explanations for a queue that is not moving, and they call for opposite responses. " +
    "`agent present, parked 2m ago` means a listener is holding a parked `corpus queue idle` " +
    "right now; `no agent — last parked 3h ago` means one was there and has been gone longer " +
    `than the grace window (${GRACE_WINDOW}), so a healthy listener between re-arms never reads ` +
    "as absent; `no agent — none has parked since the server started` means none has been " +
    "observed at all, which is also what a freshly restarted server reports, since presence is " +
    "held in memory and nothing about it is persisted. **A server that did not report the field " +
    "at all reads `agent presence unknown`** — an answer that never arrived is not an answer " +
    "saying nobody is there.\n\n" +
    "This is the workspace's grain: whether **some** lane has a listener, never how many. For a " +
    "row per lane, with its resident and what it is doing, read `corpus agents`. The two are " +
    "separate reads and may honestly disagree for one grace window — a listener parked on a lane " +
    "whose designation has just been released is present here and has no row there — so treat " +
    "them as two facts rather than one.",
  args: [],
  flags: [],
  examples: [
    {
      command: "corpus queue status",
      description: "Is the queue halted, how deep is it, and is anybody working it?",
    },
    {
      command: "corpus queue status --json",
      description:
        "One JSON value, the status verbatim: " +
        '`{"agent":{"live":true,"since":"2026-08-16T09:00:00.000Z"},"halted":false,"pending":0,' +
        '"inProgress":0,"deferred":0,"processed":12,"failed":0,"abandoned":0}`. `since` stays an ' +
        "ISO instant so you compute the age against your own clock.",
    },
    {
      command: "corpus queue status --json | jq -e '.agent.live'",
      description: "Exits non-zero when nothing is listening — a guard before enqueuing work.",
    },
  ],
  handler: (context) => runStatus(context),
};

export const reapStaleCommand: WorkspaceCommandSpec = {
  name: "reap-stale",
  summary: "Return events stranded by a crashed run to pending.",
  description:
    "Moves events left in `in-progress/` by an agent session that died back to `pending/`, so a " +
    "crash cannot strand work. The staleness threshold belongs to the server, not to this " +
    "command, so there is nothing to configure here. Reaping nothing is silent and exits 0.",
  args: [],
  flags: [],
  examples: [
    {
      command: "corpus queue reap-stale",
      description: "Recover work stranded by a crashed agent session.",
    },
    {
      command: "corpus queue reap-stale --json",
      description: 'One JSON value: `{"reaped":["evt_9f2a"]}`, empty when nothing was stale.',
    },
  ],
  handler: (context) => runReapStale(context),
};
