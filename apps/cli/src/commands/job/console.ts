import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * The console's read path and its two failed-job actions (SPEC.md §7, §11),
 * available from the terminal as well as the drawer: every queue event is a
 * job, so these are the same rows the UI renders, addressed by event id.
 */

export async function runJobList(context: WorkspaceCommandContext): Promise<void> {
  const recent = context.flags.number("recent");
  const result = await context.client.request((api) =>
    api.GET("/api/jobs", recent === undefined ? {} : { params: { query: { recent } } }),
  );
  context.out.emit(result);
  if (result.jobs.length === 0) {
    context.out.line("no jobs yet.");
    return;
  }
  for (const job of result.jobs) {
    context.out.line(`${job.eventId} ${job.status} ${job.lastLine ?? ""}`.trimEnd());
  }
}

export async function runJobRetry(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const job = await context.client.request((api) =>
    api.POST("/api/jobs/{id}/retry", { params: { path: { id } } }),
  );
  context.out.emit(job);
  context.out.line(`job ${job.eventId} is ${job.status}.`);
}

export async function runJobAbandon(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("event-id");
  const job = await context.client.request((api) =>
    api.POST("/api/jobs/{id}/abandon", { params: { path: { id } } }),
  );
  context.out.emit(job);
  context.out.line(`job ${job.eventId} is ${job.status}.`);
}

const EVENT_ID_ARG = {
  name: "event-id",
  required: true,
  description: "The job's event id.",
} as const;

export const listCommand: WorkspaceCommandSpec = {
  name: "list",
  summary: "Show recent jobs and their last log line.",
  description:
    "The console's master list from the terminal: one row per queue event with its status and " +
    "most recent log line, most recent first.",
  args: [],
  flags: [
    {
      name: "recent",
      type: "number",
      valueName: "count",
      description: "How many of the most recent jobs to show. The server applies its own default.",
    },
  ],
  examples: [
    { command: "corpus job list", description: "What has the agent been doing?" },
    {
      command: "corpus job list --recent 5 --json",
      description: 'One JSON value: `{"jobs":[{"eventId":"evt_9f2a","status":"processed",…}]}`.',
    },
  ],
  handler: (context) => runJobList(context),
};

export const retryCommand: WorkspaceCommandSpec = {
  name: "retry",
  summary: "Put a failed job back in the queue.",
  description:
    "Returns the event to `pending/` so the agent picks it up again — the terminal form of the " +
    "console's retry action. A job that is not in a retryable state answers `409` (exit 5).",
  args: [EVENT_ID_ARG],
  flags: [],
  examples: [{ command: "corpus job retry evt_9f2a", description: "Try a failed job once more." }],
  handler: (context) => runJobRetry(context),
};

export const abandonCommand: WorkspaceCommandSpec = {
  name: "abandon",
  summary: "Give up on a failed job.",
  description:
    "Moves the job's event to `abandoned/` — the other half of the console's failed-job actions. " +
    "Nothing is deleted; the event file and its log stay where the audit trail can see them.",
  args: [EVENT_ID_ARG],
  flags: [],
  examples: [
    {
      command: "corpus job abandon evt_9f2a",
      description: "Stop retrying a job that cannot work.",
    },
  ],
  handler: (context) => runJobAbandon(context),
};
