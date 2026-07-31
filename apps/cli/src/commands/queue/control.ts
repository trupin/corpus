import type { QueueStatus } from "@corpus/contract";
import type { Output } from "../../output.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The kill switch and the recovery verbs (SPEC.md §7). Halting stops
 * **consumption**, never production: comments keep enqueuing while the queue is
 * halted, and resuming makes them visible again.
 */

/**
 * The depth line, in the lifecycle order `QUEUE_EVENT_STATUSES` declares.
 * `deferred` sits between the live states and the terminal ones because that is
 * what it is (SPEC.md §7, CONTRACT-021): work waiting on a user-held lock, which
 * returns to `pending` by itself. Reading it next to `failed` is the misreading
 * the separate count exists to prevent.
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

export async function runStatus(context: WorkspaceCommandContext): Promise<void> {
  const status = await context.client.request((api) => api.GET("/api/queue/status"));
  reportStatus(context.out, status, status.halted ? "queue halted" : "queue running");
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
  summary: "Show the halt state and the queue depth.",
  description:
    "Reads `GET /api/queue/status`: whether the queue is halted, plus how many events sit in each " +
    "of `pending`, `in-progress`, `deferred`, `processed`, `failed` and `abandoned`. A non-zero " +
    "`deferred` is **not** breakage — those events are waiting on a user-held edit lock and " +
    "return to `pending` on their own when it is released, broken or reaped (SPEC.md §7).",
  args: [],
  flags: [],
  examples: [
    { command: "corpus queue status", description: "Is the queue halted, and how deep is it?" },
    {
      command: "corpus queue status --json",
      description:
        'One JSON value: `{"halted":false,"pending":0,"inProgress":0,"deferred":0,"processed":12,"failed":0,"abandoned":0}`.',
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
